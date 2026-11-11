from __future__ import annotations

import ast
import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import openpyxl
from PIL import Image

from backend import price_check, shared_folders


def _xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "TOP榜单"
    ws.append(["双11 首页铺品"])  # 表头上面的标题行
    ws.append(["模块", "", "序号", "SKU", "SPU", "商品名称", "吊牌价", "立省", "到手价", "充绒量/加绒"])
    ws.append(["男子", "羽绒服TOP榜", 1, "A1-1", "A1", "火锅羽绒 短羽绒服", 899, 500, 399, "80%鸭绒"])
    ws.append([None, None, 2, "A2-1", "A2", "拒水防泼 面包羽绒", 799, 458, 341, "85%鸭绒"])
    ws.append([None, "外套TOP榜", 1, "B1-1", "B1", "万龙甲防暴雨冲锋衣", 799, 300, 499, "加绒"])
    ws.append(["女子", "羽绒服TOP榜", 1, "C1-1", "C1", "防泼水短羽绒服", 999, 200, 799, None])
    ws.append(["儿童", "羽绒服TOP榜", 1, "C2-1", "C2", "防泼水短羽绒服", 799, 431, 368, None])
    ws.merge_cells("A3:A5")
    new = wb.create_sheet("新品上市")
    new.append(["模块", "序号", "货号", "4字利益点文案", "简化标题", "划线价", "立减", "活动价"])
    new.append(["男子", "鞋履", "D1-1", "轻量回弹", "闪击篮球鞋", None, None, None])
    new.append([None, "服饰", "D2-1", "蓄热保暖", "反伍短羽绒服", 999, 200, 799])
    wb.create_sheet("说明").append(["没有商品的说明页"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _item(name, price=None, save=None, image="男子/羽绒服.png", pos=1, **extra):
    parts = image.rsplit(".", 1)[0].split("/")
    item = {"name": name, "price": price, "save": save, "_image": image, "_path": parts, "_pos": pos}
    item.update(extra)
    return item


class LoadTableTest(unittest.TestCase):
    def test_headers_groups_and_aliases(self):
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        self.assertEqual([s.name for s in sheets], ["TOP榜单", "新品上市"])
        top, new = sheets
        self.assertEqual(set(top.fields), {"tag_price", "save", "price", "fill"})
        self.assertEqual([g["group"] for g in top.groups()],
                         [["男子", "羽绒服TOP榜"], ["男子", "外套TOP榜"], ["女子", "羽绒服TOP榜"], ["儿童", "羽绒服TOP榜"]])
        self.assertEqual(top.rows[1]["values"]["price"], "341")
        # 货号/划线价/立减/活动价 这些叫法也认；"序号"列写的是品类时当分组；利益点文案单独记
        self.assertEqual(set(new.fields), {"tag_price", "save", "price"})
        self.assertEqual([g["group"] for g in new.groups()], [["男子", "鞋履"], ["男子", "服饰"]])
        self.assertEqual((new.rows[1]["sku"], new.rows[1]["name"], new.rows[1]["copy"]), ("D2-1", "反伍短羽绒服", ["蓄热保暖"]))

    def test_pick_sheets_and_slim_large_workbook(self):
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        self.assertEqual([s.name for s in price_check.pick_sheets(sheets, ["top榜"])], ["TOP榜单"])
        self.assertEqual(len(price_check.pick_sheets(sheets, [])), 2)
        with self.assertRaises(price_check.TableError):
            price_check.pick_sheets(sheets, ["适温叠穿"])
        # 嵌了图片、带外部链接缓存的大表格：保存前去掉这些，解析结果不变
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(_xlsx())) as src, zipfile.ZipFile(buf, "w") as dst:
            for info in src.infolist():
                dst.writestr(info, src.read(info.filename))
            dst.writestr("xl/media/image1.png", b"x" * 300_000)
            dst.writestr("xl/externalLinks/externalLink1.xml", b"<x/>" * 100_000)
        with patch.object(price_check, "SLIM_ABOVE", 1000):
            slim = price_check.slim_xlsx(buf.getvalue(), "大表.xlsx")
        self.assertLess(len(slim), 50_000)
        self.assertEqual([s.rows for s in price_check.load_table(slim, "a.xlsx")], [s.rows for s in sheets])
        self.assertEqual(price_check.slim_xlsx(b"not a zip" * 1000, "坏.xlsx"), b"not a zip" * 1000)

    def test_table_without_products_is_rejected(self):
        wb = openpyxl.Workbook()
        wb.active.append(["随便写点什么"])
        buf = io.BytesIO()
        wb.save(buf)
        with self.assertRaises(price_check.TableError):
            price_check.load_table(buf.getvalue(), "a.xlsx")


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.sheets = price_check.load_table(_xlsx(), "a.xlsx")

    def test_matches_by_name_regardless_of_order(self):
        items = [_item("拒水防泼面包羽绒", 341, 458, pos=1), _item("火锅羽绒短羽绒服", 399, 271, pos=2)]
        matched = price_check.match_unit(items, self.sheets)
        self.assertEqual([matched[0]["sku"], matched[1]["sku"]], ["A2-1", "A1-1"])

    def test_same_name_in_two_groups_uses_folder_hint_and_price(self):
        girl = price_check.match_unit([_item("防泼水短羽绒服", 799, 200, image="x/女子/1.jpg")], self.sheets)
        kid = price_check.match_unit([_item("防泼水短羽绒服", 999, 999, image="x/儿童/1.jpg")], self.sheets)
        self.assertEqual((girl[0]["sku"], kid[0]["sku"]), ("C1-1", "C2-1"))

    def test_other_campaign_image_is_not_forced_onto_rows(self):
        # 旧版本图：只有一个通用名称碰巧相同、金额全不同，其余都对不上 → 整张都不算对应上
        items = [_item("防泼水短羽绒服", 719, 280, image="1104/旧.jpg", pos=1),
                 _item("韦德系列短羽绒服", 1079, 420, image="1104/旧.jpg", pos=2),
                 _item("轻盈保暖羽绒服", 503, 196, image="1104/旧.jpg", pos=3)]
        self.assertEqual(price_check.match_unit(items, self.sheets), {})

    def test_wrong_price_on_single_product_image_still_matches(self):
        matched = price_check.match_unit([_item("万龙甲防暴雨冲锋衣", 599, 200, image="外套/1.jpg")], self.sheets)
        self.assertEqual(matched[0]["sku"], "B1-1")


class JudgeTest(unittest.TestCase):
    def setUp(self):
        self.rows = {r["sku"]: r for s in price_check.load_table(_xlsx(), "a.xlsx") for r in s.rows}

    def test_amount_mismatch_and_hidden_fields(self):
        item = _item("火锅羽绒短羽绒服", "¥399", 271, fill="80%鸭绒含量")
        status, problems = price_check.judge(item, self.rows["A1-1"], {"price", "save", "fill"})
        self.assertEqual(status, "不一致")
        self.assertEqual(problems, ["立省：表格 500，图上 271"])  # 图上没印吊牌价，不比

    def test_unread_price_asks_for_manual_check(self):
        status, problems = price_check.judge(_item("拒水防泼面包羽绒", None, 458), self.rows["A2-1"], {"price", "save"})
        self.assertEqual(status, "未识别")
        self.assertIn("到手价", problems[0])

    def test_wording_difference_and_confirmation(self):
        item = _item("万龙甲防暴风冲锋衣", 499, 300, fill="加绒保暖")
        status, problems = price_check.judge(item, self.rows["B1-1"], {"price", "save", "fill"})
        self.assertEqual(status, "文案待确认")
        self.assertIn("表格「万龙甲防暴雨冲锋衣」，图上「万龙甲防暴风冲锋衣」", problems[0])
        ok = price_check.judge(item, self.rows["B1-1"], {"price", "save", "fill"}, frozenset({"万龙甲防暴雨冲锋衣"}))
        self.assertEqual(ok, ("一致", []))

    def test_fill_weight_is_not_compared_with_percentage(self):
        item = _item("火锅羽绒短羽绒服", 399, 500, fill="充绒量131g")
        self.assertEqual(price_check.judge(item, self.rows["A1-1"], {"price", "save", "fill"})[0], "一致")

    def test_benefit_copy_must_appear(self):
        item = _item("反伍短羽绒服", 799, 200, texts=["蓄热保温"])
        status, problems = price_check.judge(item, self.rows["D2-1"], {"price", "save"})
        self.assertEqual(status, "文案待确认")
        self.assertIn("蓄热保暖", problems[0])


class RunCheckTest(unittest.TestCase):
    def test_end_to_end_with_fake_recognition(self):
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        seen = {
            b"top": [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}, {"name": "拒水防泼 面包羽绒", "price": 341, "save": 271}],
            b"coat": [{"name": "万龙甲防暴风冲锋衣", "price": 499, "save": 300}],
            b"kid": [{"name": "防泼水短羽绒服", "price": 368, "save": 431}],
            b"title": [], b"old": [{"name": "别的活动的羽绒服", "price": 1, "save": 2}],
        }
        verified = []

        async def fake_ocr(data):
            if data == b"icon":
                return None
            if data == b"broken":
                raise RuntimeError("识别失败")
            return seen[data]

        async def fake_verify(data, pairs):
            verified.extend(pairs)
            return [False] * len(pairs)

        images = [("男子/羽绒服.png", lambda: b"top"), ("男子/外套/1.jpg", lambda: b"coat"), ("儿童/1.jpg", lambda: b"kid"),
                  ("标题.jpg", lambda: b"title"), ("tab.png", lambda: b"icon"), ("坏图.jpg", lambda: b"broken"),
                  ("1104/旧.jpg", lambda: b"old"), ("备份/羽绒服.png", lambda: b"top")]
        with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "verify_wording", fake_verify):
            result = asyncio.run(price_check.run_check(images, sheets))
        by_image = {(r["item"]["_image"], r["item"]["_pos"]): r["status"] for r in result["records"]}
        self.assertEqual(by_image[("男子/羽绒服.png", 1)], "一致")
        self.assertEqual(by_image[("男子/羽绒服.png", 2)], "不一致")
        self.assertEqual(by_image[("备份/羽绒服.png", 2)], "不一致")  # 重复的图也各自报出来
        self.assertEqual(by_image[("男子/外套/1.jpg", 1)], "文案待确认")
        self.assertEqual(by_image[("儿童/1.jpg", 1)], "一致")
        self.assertEqual(verified, [("万龙甲防暴雨冲锋衣", "万龙甲防暴风冲锋衣")])
        self.assertEqual([it["_image"] for it in result["unmatched"]], ["1104/旧.jpg"])
        self.assertEqual((result["skipped_small"], result["no_product_images"], len(result["failed"])), (1, ["标题.jpg"], 1))
        self.assertEqual(sorted(r["sku"] for r in result["uncovered"]), ["C1-1", "D2-1"])
        report = openpyxl.load_workbook(io.BytesIO(price_check.build_report(result)))
        self.assertEqual(report.sheetnames, ["汇总", "核对明细", "图上有表格没有", "表格有图片没有"])
        self.assertEqual(report["核对明细"].cell(2, 1).value, "不一致")  # 有问题的排在前面

    def test_misread_numbers_are_dropped_or_reread(self):
        # 立省的数字被又填进吊牌价：吊牌价不可能小于等于到手价，直接丢弃
        self.assertIsNone(price_check.sanitize_item({"price": 360, "save": 539, "tag_price": 539})["tag_price"])
        self.assertEqual(price_check.sanitize_item({"price": 360, "save": 539, "tag_price": 899})["tag_price"], 899)
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        reads = {b"flaky": iter([[{"name": "火锅羽绒 短羽绒服", "price": 899, "save": 500}],   # 第一遍把价格读错
                                 [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]]),
                 b"wrong": iter([[{"name": "拒水防泼 面包羽绒", "price": 341, "save": 271}]] * 2)}  # 两遍都是 271：真的错

        async def fake_ocr(data):
            return next(reads[data])

        images = [("a/1.jpg", lambda: b"flaky"), ("b/1.jpg", lambda: b"wrong")]
        with patch.object(price_check, "ocr_image", fake_ocr):
            result = asyncio.run(price_check.run_check(images, sheets))
        status = {r["row"]["sku"]: (r["status"], r["problems"]) for r in result["records"]}
        self.assertEqual(status["A1-1"], ("一致", []))
        self.assertEqual(status["A2-1"], ("不一致", ["立省：表格 458，图上 271"]))

    def test_tall_image_is_split_at_blank_rows(self):
        im = Image.new("RGB", (200, 1200), "white")
        for top in (100, 500, 900):  # 三个色块，中间留白
            im.paste((200, 30, 30), (20, top, 180, top + 200))
        parts = price_check.split_tall(im)
        self.assertEqual(sum(p.height for p in parts), 1200)
        self.assertGreater(len(parts), 1)
        for part in parts[:-1]:  # 切口都落在留白上
            self.assertEqual(part.getpixel((100, part.height - 1)), (255, 255, 255))
        self.assertEqual(len(price_check.split_tall(Image.new("RGB", (750, 1100)))), 1)


class SharedFoldersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "share"
        (self.root / "temp" / "改价" / "TOP榜" / "男子").mkdir(parents=True)
        Image.new("RGB", (720, 940)).save(self.root / "temp" / "改价" / "TOP榜" / "男子" / "羽绒服.PNG")
        for name in ("男子-1.jpg", "男子-2.jpg", "男子4.jpg", "男子-5.jpg", "男子-3.jpg"):
            Image.new("RGB", (200, 340)).save(self.root / "temp" / "改价" / "TOP榜" / name)
        Image.new("RGB", (60, 60)).save(self.root / "temp" / "改价" / "TOP榜" / "扫描件.TIF")
        for junk in ("Thumbs.db", "设计稿.psd", "~$铺品.xlsx"):
            (self.root / "temp" / "改价" / junk).write_bytes(b"x")
        (self.root / "temp" / "改价" / "铺品.xlsx").write_bytes(b"x")
        (Path(self.tmp.name) / "secret.png").write_bytes(b"x")
        config = Path(self.tmp.name) / "shared.json"
        config.write_text(json.dumps([
            {"name": "素材库", "path": str(self.root), "aliases": ["smb://192.168.152.52/素材库", "\\\\192.168.152.52\\素材库"]},
            {"name": "财务", "path": str(Path(self.tmp.name) / "finance"), "users": ["boss"]},
        ]), encoding="utf-8")
        self.patch = patch.object(shared_folders.settings, "shared_folders_path", config)
        self.patch.start()
        self.user = {"id": "u1", "username": "alice"}

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_many_ways_to_write_the_same_path(self):
        for raw in ["smb://192.168.152.52/素材库/temp/改价", "\\\\192.168.152.52\\素材库\\temp\\改价\\", "素材库/temp/改价",
                    "Z:\\temp\\改价", "\\\\fileserver\\素材库\\temp\\改价", "/Volumes/素材库/temp/改价", " 素材库/TEMP/改价 "]:
            with self.subTest(raw):
                _root, path, shown = shared_folders.resolve(self.user, raw)
                self.assertTrue(path.is_dir())
                self.assertEqual(shown.casefold(), "素材库/temp/改价")  # 不区分大小写的文件系统上保留用户的写法

    def test_relative_path_with_base_and_loose_file_names(self):
        data, name, shown = shared_folders.read_file(self.user, "top榜/男子/羽绒服.png", shared_folders.IMAGE_SUFFIXES,
                                                     base="smb://192.168.152.52/素材库/temp/改价")
        self.assertEqual((name.casefold(), shown.casefold()), ("羽绒服.png", "素材库/temp/改价/top榜/男子/羽绒服.png"))
        self.assertTrue(data)

    def test_rejects_outside_paths_and_unlisted_users(self):
        for raw in ["素材库/../secret.png", "/etc/passwd", "财务/报表", "素材库/temp/../../secret.png"]:
            with self.subTest(raw), self.assertRaises(shared_folders.SharedFolderError):
                root, path, _ = shared_folders.resolve(self.user, raw)
                if not path.exists():
                    raise shared_folders.SharedFolderError("不存在")
        link = self.root / "temp" / "逃逸"
        link.symlink_to(Path(self.tmp.name))
        with self.assertRaises(shared_folders.SharedFolderError):
            shared_folders.resolve(self.user, "素材库/temp/逃逸/secret.png")

    def test_listing_is_deep_sorted_and_summarises_other_files(self):
        listed = shared_folders.list_folder(self.user, "素材库/temp/改价")
        folders = {f["dir"]: f for f in listed["folders"]}
        self.assertEqual(folders["."]["tables"], ["铺品.xlsx"])
        self.assertEqual(folders["."]["other_files"], "psd×1")
        self.assertEqual(folders["TOP榜"]["images"], ["扫描件.TIF (60x60)", "男子-1.jpg (200x340)", "男子-2.jpg (200x340)",
                                                    "男子-3.jpg (200x340)", "男子4.jpg (200x340)", "男子-5.jpg (200x340)"])
        self.assertEqual(folders["TOP榜/男子"]["images"], ["羽绒服.PNG (720x940)"])
        _shown, files, more = shared_folders.find_files(self.user, "素材库/temp/改价", shared_folders.IMAGE_SUFFIXES, 100)
        self.assertEqual((len(files), more), (7, False))

    def test_no_config_means_no_access(self):
        with patch.object(shared_folders.settings, "shared_folders_path", Path(self.tmp.name) / "none.json"):
            with self.assertRaises(shared_folders.SharedFolderError):
                shared_folders.resolve(self.user, "素材库/temp/改价")


class ReadOnlyGuardTest(unittest.TestCase):
    """共享文件夹只能读：访问共享盘的代码里不允许出现任何写入、删除、移动、改名的调用。"""

    FORBIDDEN = {"unlink", "remove", "rmdir", "rmtree", "removedirs", "rename", "renames", "move",
                 "copy2", "copyfile", "copytree", "write_bytes", "write_text", "mkdir", "makedirs", "touch", "chmod",
                 "chown", "symlink_to", "hardlink_to", "link_to", "truncate", "save"}
    OS_READ_ONLY = {"scandir"}  # os 模块里只允许用这些

    def test_shared_folder_module_has_no_mutating_calls(self):
        source = Path(shared_folders.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = {alias.name for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names}
        self.assertFalse({"shutil", "subprocess", "tempfile"} & imported)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                self.assertNotIn(name, self.FORBIDDEN, f"shared_folders.py 第 {node.lineno} 行调用了 {name}")
                if isinstance(node.func, ast.Attribute) and ast.unparse(node.func.value) == "os":
                    self.assertIn(name, self.OS_READ_ONLY, f"shared_folders.py 第 {node.lineno} 行调用了 os.{name}")
                if name == "open":  # 只允许只读打开
                    modes = [a.value for a in node.args[1:2] if isinstance(a, ast.Constant)]
                    modes += [k.value.value for k in node.keywords if k.arg == "mode" and isinstance(k.value, ast.Constant)]
                    for mode in modes:
                        self.assertFalse(set(str(mode)) & set("wax+"), f"第 {node.lineno} 行用写模式打开文件")

    def test_tools_only_write_under_local_output(self):
        from backend.agent2 import shared_tools
        tree = ast.parse(Path(shared_tools.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in self.FORBIDDEN:
                target = ast.unparse(node.func.value)
                # 写操作只能落在本机输出目录（out）或内存缓冲（buf、图片对象）上
                self.assertTrue(target.startswith(("out", "buf", "im")) or node.func.attr == "save" or "to_thread" in target,
                                f"shared_tools.py 第 {node.lineno} 行：{target}.{node.func.attr}")
        writes = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr == "write_bytes"]
        self.assertTrue(writes and all(w == "out.write_bytes" for w in writes))

    def test_reading_leaves_folder_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "share"
            (root / "a").mkdir(parents=True)
            Image.new("RGB", (300, 300)).save(root / "a" / "1.png")
            (root / "a" / "表.xlsx").write_bytes(_xlsx())
            config = Path(tmp) / "shared.json"
            config.write_text(json.dumps([{"name": "素材库", "path": str(root)}]), encoding="utf-8")

            def snapshot():
                return sorted((p.relative_to(root).as_posix(), p.stat().st_size, p.stat().st_mtime_ns)
                              for p in root.rglob("*"))

            before = snapshot()
            with patch.object(shared_folders.settings, "shared_folders_path", config):
                user = {"id": "u1"}
                shared_folders.list_folder(user, "素材库")
                shared_folders.find_files(user, "素材库", shared_folders.IMAGE_SUFFIXES, 10)
                shared_folders.read_file(user, "素材库/a/1.png", shared_folders.IMAGE_SUFFIXES)
                shared_folders.read_file(user, "素材库/a/表.xlsx", shared_folders.TABLE_SUFFIXES)
            self.assertEqual(snapshot(), before)


class AgentToolsTest(unittest.TestCase):
    def test_table_upload_and_check_prices_tool(self):
        from backend import job_store
        from backend.agent2 import service, shared_tools, store
        from backend.agent2.engine import ToolContext
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(job_store, "_DB_PATH", Path(tmp) / "a2.db"), \
                patch.object(service.settings, "output_path", Path(tmp) / "out"):
            job_store.init_db()
            store.init_tables()
            root = Path(tmp) / "share"
            (root / "活动" / "男子").mkdir(parents=True)
            Image.new("RGB", (720, 940)).save(root / "活动" / "男子" / "羽绒服.png")
            config = Path(tmp) / "shared.json"
            config.write_text(json.dumps([{"name": "素材库", "path": str(root)}]), encoding="utf-8")
            session = store.create_session("u1")
            user = {"id": "u1"}
            table = service.save_upload(user, session["id"], _xlsx(), "铺品.xlsx")
            self.assertEqual((table["kind"], table["label"]), ("table", "铺品.xlsx"))
            events = []

            async def emit(*args):
                events.append(args)

            async def publish(event):
                events.append(("publish", event["type"]))

            async def fake_ocr(data):
                return [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 271}]

            ctx = ToolContext(user=user, session_id=session["id"], turn_id="t", call_id="c", emit=emit, state={},
                              publish=publish)
            with patch.object(shared_folders.settings, "shared_folders_path", config), \
                    patch.object(price_check, "ocr_image", fake_ocr):
                overview = asyncio.run(shared_tools.read_table(ctx, {}))  # 不填 source：用对话里上传的表格
                for early in ({"folder": "Z:\\活动"}, {"folder": "Z:\\活动", "request": "smb://192.168.1.2/素材库/活动"},
                              {"folder": "Z:\\活动", "request": "铺品.xlsx"}):
                    self.assertIn("还没有提出核对要求", asyncio.run(shared_tools.check_prices(ctx, early))["error"])
                result = asyncio.run(shared_tools.check_prices(ctx, {"folder": "Z:\\活动", "request": "核对一下价格文案信息是否有误"}))
            self.assertEqual([s["sheet"] for s in overview["sheets"]], ["TOP榜单", "新品上市"])
            self.assertEqual((result["checked"], result["counts"]["不一致"]), (1, 1))
            messages = [a[1]["message"] for a in events if a[0] == "tool.progress"]
            self.assertTrue(messages[0].startswith("正在读取表格"))
            self.assertTrue(any(m.startswith("正在识别图片") for m in messages))  # 同一阶段每秒最多一条
            self.assertTrue(messages[-1].startswith("正在生成报告"))
            self.assertIn("立省：表格 500，图上 271", result["价格不一致"][0])
            self.assertEqual(result["表格有价格但没找到对应图片"]["数量"], 5)
            report = store.get_artifact(result["files"][0]["id"], "u1")
            self.assertEqual(report["kind"], "file")
            self.assertTrue(Path(report["path"]).is_relative_to(Path(tmp) / "out"))  # 报告写在本机输出目录
            self.assertEqual(sorted(p.name for p in (root / "活动").rglob("*")), ["男子", "羽绒服.png"])  # 共享盘没多出文件
            self.assertIn(("publish", "artifact.created"), events)
            # 表格截图 + 直接上传到对话里的图片：没有共享文件夹也能核对
            buf = io.BytesIO()
            Image.new("RGB", (800, 600)).save(buf, format="PNG")
            shot = service.save_upload(user, session["id"], buf.getvalue(), "表格截图.png")
            poster = service.save_upload(user, session["id"], buf.getvalue(), "海报.png")

            async def fake_table_image(data):
                return price_check.load_table(_xlsx(), "a.xlsx")[:1]

            with patch.object(price_check, "ocr_image", fake_ocr), \
                    patch.object(price_check, "load_table_image", fake_table_image):
                uploaded = asyncio.run(shared_tools.check_prices(ctx, {
                    "request": "核对一下价格", "table": shot["id"], "image_ids": [shot["id"], poster["id"]]}))
            self.assertEqual((uploaded["images_scanned"], uploaded["counts"]["不一致"]), (1, 1))
            self.assertTrue(any("截图" in note for note in uploaded["说明"]))


class TableImageTest(unittest.TestCase):
    def test_screenshot_rows_become_a_sheet_and_inconsistent_rows_are_flagged(self):
        answer = {"headers": ["模块", "序号", "SKU", "商品名称", "吊牌价", "立省", "到手价"],
                  "rows": [["限时闪购", "1", "A1-1", "短羽绒服", "899", "539", "360"],
                           ["", "2", "A2-1", "鹅绒马甲", "799", "479", "330"]]}

        class Resp:
            def json(self):
                return {"choices": [{"message": {"content": "```json\n" + json.dumps(answer, ensure_ascii=False) + "\n```"}}]}

        async def fake_completion(*args, **kwargs):
            return Resp()

        buf = io.BytesIO()
        Image.new("RGB", (900, 400), "white").save(buf, format="PNG")
        with patch.object(price_check, "routed_chat_completion", fake_completion):
            sheets = asyncio.run(price_check.load_table_image(buf.getvalue()))
        rows = sheets[0].rows
        self.assertEqual([(r["sku"], r["group"], r["values"]["price"]) for r in rows],
                         [("A1-1", ["限时闪购"], "360"), ("A2-1", ["限时闪购"], "330")])
        warnings = price_check.table_warnings(sheets)
        self.assertEqual(len(warnings), 1)
        self.assertIn("A2-1", warnings[0])

        # 截图读出来的名称可能差一个字（短羽绒服 / 短羽绒衣）：不报文案；数字照常比
        async def fake_ocr(data):
            return [{"name": "短羽绒衣", "price": 360, "save": 500}]

        with patch.object(price_check, "ocr_image", fake_ocr):
            result = asyncio.run(price_check.run_check([("a.png", lambda: b"x")], sheets))
        self.assertEqual(result["records"][0]["problems"], ["立省：表格 539，图上 500"])


if __name__ == "__main__":
    unittest.main()
