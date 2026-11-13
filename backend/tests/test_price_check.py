from __future__ import annotations

import ast
import asyncio
import io
import json
import os
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


def _assign(mapping=None, default=None):
    """替换"交给模型判断对应分组"这一步：mapping 是 {图片路径: (分组名, start)}，没列出的用 default（分组名或 None）。"""
    mapping = mapping or {}

    async def fake(folder, entries, catalog, others=None, dates=None):
        by_name = {g["name"]: g for g in catalog}
        out = {}
        for rel, _items in entries:
            name, start = mapping.get(rel, (default, 1))
            out[rel] = {"group": by_name.get(name) if name else None, "start": start, "reason": "测试"}
        return out
    return patch.object(price_check, "assign_groups", fake)


def _kid_shoes():
    # 线上的童鞋这一组：第 1 行是 KV 位（纵横 LOW户外鞋，没价格），后面三个带价格
    return price_check._sheet_rows("表格截图", [["模块", "序号", "SKU", "商品名称", "吊牌价", "立省", "到手价"],
                                            ["儿童", "鞋履", "YKEW032-14", "纵横 LOW户外鞋", "", "", ""],
                                            ["", "", "YKFW202-5", "织雀2跑步鞋", 499, 150, 349],
                                            ["", "", "YKFW156-7", "步态引导跑鞋", 599, 180, 419],
                                            ["", "", "YKCW180-34", "驭雪休闲鞋", 399, 80, 319]])


class PairTest(unittest.TestCase):
    """模型定了是哪一组、从第几个开始以后，程序按位置一一对应：名称和价格不参与决定对应谁。"""

    def setUp(self):
        self.group = price_check._group_catalog([_kid_shoes()])[0]

    def test_kv_slot_and_priced_items_line_up_by_position(self):
        image = "11-新品上市/童-鞋履.png"
        items = [_item("暖行3 中帮长绒棉鞋", None, None, image=image, pos=1),
                 _item("赤兔9 PRO跑步鞋", 615, 84, image=image, pos=2),
                 _item("启悦3加绒休闲鞋", 319, 80, image=image, pos=3),
                 _item("软糖轻暖绒棉鞋", 319, 80, image=image, pos=4)]
        pairs, extra = price_check.pair_by_position(items, self.group, 1, "文件名童-鞋履")
        self.assertEqual(extra, [])
        self.assertEqual([(it["name"], row["sku"]) for it, row in pairs],
                         [("暖行3 中帮长绒棉鞋", "YKEW032-14"), ("赤兔9 PRO跑步鞋", "YKFW202-5"),
                          ("启悦3加绒休闲鞋", "YKFW156-7"), ("软糖轻暖绒棉鞋", "YKCW180-34")])
        self.assertEqual([price_check.judge(it, row, {"price", "save"})[0] for it, row in pairs],
                         ["文案待确认", "不一致", "不一致", "文案待确认"])
        self.assertIn("表格这一组第 1 个带价格的商品", pairs[1][0]["_basis"])
        # 识别时没把 KV 大图算成商品，结果一样
        pairs, _extra = price_check.pair_by_position(items[1:], self.group, 1, "")
        self.assertEqual([row["sku"] for _it, row in pairs], ["YKFW202-5", "YKFW156-7", "YKCW180-34"])

    def test_kv_only_module_images_use_the_kv_slot_number(self):
        # 正式路径复现：越冬服饰 KV 组 3 行都不带价格，每个模块一张主图。模型判断"加绒裤装.jpg"对第 3 个 KV 位，
        # 不能都配到第 1 个（之前两张图都被配到"珑壳 加绒防泼水外套"，报出假问题）
        winter = price_check._sheet_rows("绒暖越冬-服饰", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"]] + [
            ["KV", None, sku, name, None, None] for sku, name in
            [("K1", "珑壳 加绒防泼水外套"), ("K2", "保暖亲肤 长袖T恤"), ("K3", "加绒保暖 直筒宽松卫裤")]])
        group = price_check._group_catalog([winter])[0]
        self.assertEqual(len(group["plain"]), 3)
        pairs, extra = price_check.pair_by_position([_item("加绒保暖 直筒宽松卫裤", None, None, pos=1)], group, 3, "")
        self.assertEqual(([row["sku"] for _it, row in pairs], extra), (["K3"], []))
        self.assertIn("表格这一组第 3 个 KV 位", pairs[0][0]["_basis"])
        self.assertIn("KV 位：1.珑壳 加绒防泼水外套；2.保暖亲肤 长袖T恤；3.加绒保暖 直筒宽松卫裤",
                      price_check._describe_groups([group]))

    def test_wording_split_into_two_pieces_still_counts(self):
        # 正式路径复现：图上"保暖亲肤 长袖T恤"被识别成名称"长袖T恤" + 补充文字"保暖亲肤"，不能报文案待确认
        row = {"name": "保暖亲肤 长袖T恤", "copy": ["加绒保暖"]}
        split = {"name": "长袖T恤", "texts": ["保暖亲肤", "加绒保暖"]}
        self.assertEqual(price_check.wording_diffs(split, row), [])
        # 两段里少了字（图上真的少印了"亲"）照样报
        short = {"name": "长袖T恤", "texts": ["保暖肤", "加绒保暖"]}
        self.assertEqual([t for t, *_ in price_check.wording_diffs(short, row)], ["保暖亲肤 长袖T恤"])
        # 只印了一半也照样报
        self.assertEqual([t for t, *_ in price_check.wording_diffs({"name": "长袖T恤", "texts": ["加绒保暖"]}, row)],
                         ["保暖亲肤 长袖T恤"])

    def test_same_price_as_another_row_does_not_move_the_item(self):
        # 图上第 1 个的价格恰好等于表格第 3 个：仍然对第 1 个，报价格不一致
        items = [_item("某款鞋", 319, 80, pos=1)]
        pairs, _extra = price_check.pair_by_position(items, self.group, 1, "")
        self.assertEqual(pairs[0][1]["sku"], "YKFW202-5")
        self.assertEqual(price_check.judge(pairs[0][0], pairs[0][1], {"price", "save"})[0], "不一致")

    def test_single_product_card_starts_where_the_model_says(self):
        # 单品卡片"儿童-3"：模型判断从第 3 个开始；接着数的卡片不再对 KV 位
        items = [_item("驭雪休闲鞋", 319, 80, pos=1), _item("不带价格的装饰图", None, None, pos=2)]
        pairs, extra = price_check.pair_by_position(items, self.group, 3, "")
        self.assertEqual(([row["sku"] for _it, row in pairs], extra), (["YKCW180-34"], []))

    def test_extra_priced_items_beyond_the_table_are_set_aside(self):
        items = [_item(f"商品{i}", 100 + i, 10, pos=i + 1) for i in range(5)]
        pairs, extra = price_check.pair_by_position(items, self.group, 1, "")
        self.assertEqual((len(pairs), [it["name"] for it in extra]), (3, ["商品3", "商品4"]))


class AssignTest(unittest.TestCase):
    """交给模型判断对应分组：给它的内容里有分组目录和图上读出的商品，解析它的回答。"""

    def test_prompt_and_answer_parsing(self):
        catalog = price_check._group_catalog(price_check.load_table(_xlsx(), "a.xlsx"))
        seen = {}

        class Resp:
            def json(self):
                return {"choices": [{"message": {"content": "```json\n" + json.dumps([
                    {"image": 1, "group": 1, "start": 1, "reason": "文件名男子/羽绒服"},
                    {"image": 2, "group": None, "start": 1, "reason": "旧版本"},
                    {"image": 9, "group": 1, "start": 1}], ensure_ascii=False) + "\n```"}}]}

        async def fake_completion(purpose, payload, **kwargs):
            seen["prompt"] = payload["messages"][0]["content"]
            seen["purpose"] = purpose
            return Resp()

        entries = [("男子/羽绒服.png", [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]),
                   ("1104/旧.jpg", RuntimeError("超时"))]
        with patch.object(price_check, "routed_chat_completion", fake_completion):
            out = asyncio.run(price_check.assign_groups("活动", entries, catalog, others=["1104/别的.jpg"],
                                                        dates={"1104/旧.jpg": "2026-11-04 15:13", "1104/别的.jpg": "2026-11-03 10:00"}))
        # 修改时间给模型判断版本：本批的图和其它图都带上
        self.assertIn("[2] 1104/旧.jpg（修改于 2026-11-04 15:13）：识别失败", seen["prompt"])
        self.assertIn("1104/别的.jpg（修改于 2026-11-03 10:00）", seen["prompt"])
        self.assertEqual(seen["purpose"], "check_llm")  # 单独路由到更强的模型
        self.assertIn("[1] TOP榜单 / 男子 / 羽绒服TOP榜｜带价格：1.火锅羽绒 短羽绒服；2.拒水防泼 面包羽绒", seen["prompt"])
        # 利益点文案也给模型（KV 行序号列写的"0~10℃"等是对应哪个模块的线索，同样带上）
        self.assertIn("KV 位：1.闪击篮球鞋｜轻量回弹", seen["prompt"])
        self.assertIn("[1] 男子/羽绒服.png：1.火锅羽绒 短羽绒服（立省500、到手价399）", seen["prompt"])
        self.assertEqual(out["男子/羽绒服.png"]["group"]["name"], "TOP榜单 / 男子 / 羽绒服TOP榜")
        self.assertEqual((out["1104/旧.jpg"]["group"], out["1104/旧.jpg"]["reason"]), (None, "旧版本"))

    def test_model_failure_leaves_images_unchecked_with_a_reason(self):
        async def broken(*args, **kwargs):
            raise RuntimeError("线路断开")

        with patch.object(price_check, "routed_chat_completion", broken):
            out = asyncio.run(price_check.assign_groups("活动", [("a.png", [])], []))
        self.assertIsNone(out["a.png"]["group"])
        self.assertIn("判断对应分组失败", out["a.png"]["reason"])
        self.assertTrue(out["a.png"]["error"])  # 和模型明确判断"不对应表格"区分开

    def _replies(self, *replies):
        """模型依次给出的回答；记录每次收到的提示词。"""
        prompts, queue = [], list(replies)

        class Resp:
            def __init__(self, answer):
                self.answer = answer

            def json(self):
                return {"choices": [{"message": {"content": json.dumps(self.answer, ensure_ascii=False)}}]}

        async def fake(purpose, payload, **kwargs):
            prompts.append(payload["messages"][0]["content"])
            return Resp(queue.pop(0))
        return fake, prompts

    def test_answers_are_checked_per_image_and_retried(self):
        # 审核复现：模型只回答了 a.jpg，b.jpg 不能被当成"和表格无关"静默跳过
        catalog = price_check._group_catalog(price_check.load_table(_xlsx(), "a.xlsx"))
        priced = [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]
        entries = [("a.jpg", priced), ("b.jpg", priced)]
        fake, prompts = self._replies([{"image": 1, "group": 1, "start": 1, "reason": "a"}],
                                      [{"image": 1, "group": 1, "start": 1}, {"image": 2, "group": 1, "start": 2, "reason": "b"}])
        with patch.object(price_check, "routed_chat_completion", fake):
            out = asyncio.run(price_check.assign_groups("活动", entries, catalog))
        self.assertEqual(len(prompts), 2)
        self.assertIn("图片 2：模型没有给出这张图的对应", prompts[1])  # 重试时告诉模型哪张没答
        self.assertEqual([(out[r]["group"]["id"], out[r]["start"], out[r].get("error")) for r in ("a.jpg", "b.jpg")],
                         [(1, 1, None), (1, 2, None)])

    def test_invalid_answers_end_as_assignment_failures(self):
        catalog = price_check._group_catalog(price_check.load_table(_xlsx(), "a.xlsx"))
        priced = [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]
        kv = [{"name": "闪击篮球鞋"}]
        entries = [("缺项.jpg", priced), ("重复.jpg", priced), ("非法分组.jpg", priced), ("越界.jpg", priced),
                   ("KV越界.jpg", kv), ("不对应.jpg", priced)]
        bad = [{"image": 2, "group": 1, "start": 1}, {"image": 2, "group": 2, "start": 1},   # 同一张图两个不同答案
               {"image": 3, "group": 99, "start": 1}, {"image": 4, "group": 1, "start": 3},  # 第 1 组只有 2 个带价格的
               {"image": 5, "group": 5, "start": 2},                                          # 第 5 组只有 1 个 KV 位
               {"image": 6, "group": None, "start": 1, "reason": "导航图"}]
        fake, prompts = self._replies(*[bad] * (price_check.OCR_RETRIES + 1))
        with patch.object(price_check, "routed_chat_completion", fake):
            out = asyncio.run(price_check.assign_groups("活动", entries, catalog))
        self.assertEqual(len(prompts), price_check.OCR_RETRIES + 1)  # 无效的都重试过
        reasons = {rel: out[rel]["reason"] for rel, _items in entries}
        self.assertIn("模型没有给出这张图的对应", reasons["缺项.jpg"])
        self.assertIn("同一张图给出了不同的对应", reasons["重复.jpg"])
        self.assertIn("分组编号 99 不在表格分组目录里", reasons["非法分组.jpg"])
        self.assertIn("start 3 超出了第 1 组的范围（1~2）", reasons["越界.jpg"])
        self.assertIn("start 2 超出了第 5 组的范围（1~1）", reasons["KV越界.jpg"])
        self.assertTrue(all(out[rel].get("error") for rel in reasons if rel != "不对应.jpg"))
        # 模型明确判断不对应表格（group 为 null）是有效回答，不算失败
        self.assertEqual((out["不对应.jpg"]["group"], out["不对应.jpg"].get("error"), out["不对应.jpg"]["reason"]),
                         (None, None, "导航图"))


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
        mapping = {"男子/羽绒服.png": ("TOP榜单 / 男子 / 羽绒服TOP榜", 1), "备份/羽绒服.png": ("TOP榜单 / 男子 / 羽绒服TOP榜", 1),
                   "男子/外套/1.jpg": ("TOP榜单 / 男子 / 外套TOP榜", 1), "儿童/1.jpg": ("TOP榜单 / 儿童 / 羽绒服TOP榜", 1)}
        with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "verify_wording", fake_verify), \
                _assign(mapping):
            result = asyncio.run(price_check.run_check(images, sheets))
        by_image = {(r["item"]["_image"], r["item"]["_pos"]): r["status"] for r in result["records"]}
        self.assertEqual(by_image[("男子/羽绒服.png", 1)], "一致")
        self.assertEqual(by_image[("男子/羽绒服.png", 2)], "不一致")
        self.assertEqual(by_image[("备份/羽绒服.png", 2)], "不一致")  # 重复的图也各自报出来
        self.assertEqual(by_image[("男子/外套/1.jpg", 1)], "文案待确认")
        self.assertEqual(by_image[("儿童/1.jpg", 1)], "一致")
        self.assertEqual(verified, [])  # 重新读图仍是"防暴风"，不需要再二选一，直接保留提示
        self.assertEqual([it["_image"] for it in result["unmatched"]], ["1104/旧.jpg"])
        self.assertEqual((result["skipped_small"], result["no_product_images"], len(result["failed"])), (1, ["标题.jpg"], 1))
        # 核对到的几组（男子羽绒服、男子外套、儿童羽绒服）都找到了图；女子组、新品上市这次没核对，不算"没找到图"
        self.assertEqual(result["uncovered"], [])
        wrong = next(r for r in result["records"] if r["status"] == "不一致")
        self.assertEqual(wrong["diffs"], [{"kind": "价格", "label": "立省", "table": "458", "image": "271"}])

    def test_second_full_poster_with_wrong_prices_is_reported(self):
        # 审核复现：表格 2 个商品，同一目录两张完整海报都展示这 2 个；第二张价格写成 999、888
        sheet = price_check._sheet_rows("限时闪购", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
                                                ["限时闪购", 1, "F0-1", "防泼水短羽绒服", 539, 360],
                                                ["", 2, "F1-1", "防泼水鹅绒马甲", 479, 320]])
        reads = {b"a": [{"name": "防泼水短羽绒服", "price": 360, "save": 539}, {"name": "防泼水鹅绒马甲", "price": 320, "save": 479}],
                 b"b": [{"name": "防泼水短羽绒服", "price": 999, "save": 539}, {"name": "防泼水鹅绒马甲", "price": 888, "save": 479}]}

        async def fake_ocr(data):
            return reads[data]

        images = [("8-限时闪购/限时闪购.jpg", lambda: b"a"), ("8-限时闪购/限时闪购-750.jpg", lambda: b"b")]
        with patch.object(price_check, "ocr_image", fake_ocr), _assign(default="限时闪购 / 限时闪购"):
            result = asyncio.run(price_check.run_check(images, [sheet]))
        found = sorted((r["item"]["_image"], r["row"]["sku"], r["status"]) for r in result["records"])
        self.assertEqual(found, [("8-限时闪购/限时闪购-750.jpg", "F0-1", "不一致"), ("8-限时闪购/限时闪购-750.jpg", "F1-1", "不一致"),
                                 ("8-限时闪购/限时闪购.jpg", "F0-1", "一致"), ("8-限时闪购/限时闪购.jpg", "F1-1", "一致")])
        self.assertEqual(result["unmatched"], [])

    def test_table_is_the_reference_extra_images_are_ignored(self):
        # 以表格为准：旧版本图（整张都对不上）在表格这一组已经被别的图核对完时不提示；表格那一组没核对到时才提示
        sheet = price_check._sheet_rows("限时闪购", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"]] + [
            ["限时闪购" if i == 0 else "", i + 1, f"F{i}-1", f"闪购商品{i}", 100 + i, 300 + i] for i in range(3)])
        good = [{"name": f"闪购商品{i}", "price": 300 + i, "save": 100 + i} for i in range(3)]
        old = [{"name": f"别的活动{i}", "price": 900 + i, "save": 10 + i} for i in range(3)]

        async def fake_ocr(data):
            return {b"good": good, b"old": old}[data]

        # 模型判断：同组有正式版时，1104 里的是旧版本（group 为 null），不核对
        with patch.object(price_check, "ocr_image", fake_ocr), \
                _assign({"8-限时闪购/限时闪购.jpg": ("限时闪购 / 限时闪购", 1), "8-限时闪购/1104/限时闪购.jpg": (None, 1)}):
            both = asyncio.run(price_check.run_check(
                [("8-限时闪购/限时闪购.jpg", lambda: b"good"), ("8-限时闪购/1104/限时闪购.jpg", lambda: b"old")], [sheet]))
        # 只有这一张：模型把它对到这一组，表格为准，逐项报出每个位置的差异
        with patch.object(price_check, "ocr_image", fake_ocr), _assign(default="限时闪购 / 限时闪购"):
            only_old = asyncio.run(price_check.run_check([("8-限时闪购/1104/限时闪购.jpg", lambda: b"old")], [sheet]))
        self.assertEqual(both["uncovered"], [])
        self.assertEqual({r["item"]["_image"] for r in both["records"]}, {"8-限时闪购/限时闪购.jpg"})
        # 只有这一张：表格为准，逐项报出每个位置的差异，并提示整张差别很大（例如图还没按新表格更新）
        self.assertEqual([(r["row"]["sku"], r["status"]) for r in only_old["records"]],
                         [("F0-1", "不一致"), ("F1-1", "不一致"), ("F2-1", "不一致")])
        self.assertEqual(only_old["uncovered"], [])
        groups = price_check.coverage([sheet], only_old)
        self.assertEqual(groups[0]["结果"], "有问题")

    def test_module_whose_images_all_fail_stays_in_the_conclusion(self):
        # 审核复现：同时核对"限时闪购"和"新品上市"，新品的图识别超时，结论里不能没有它
        flash = price_check._sheet_rows("限时闪购", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
                                                ["限时闪购", 1, "F0-1", "防泼水短羽绒服", 539, 360]])
        new = price_check._sheet_rows("新品上市", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
                                              ["女子", "服饰", "N0-1", "草莓熊联名卫衣", 90, 359],
                                              ["男子", "鞋履", "N1-1", "闪击篮球鞋", 240, 559]])

        async def fake_ocr(data):
            if data == b"timeout":
                raise RuntimeError("识别超时")
            if data == b"blank":
                return []
            return [{"name": "防泼水短羽绒服", "price": 360, "save": 539}]

        images = [("8-限时闪购/限时闪购.jpg", lambda: b"ok"), ("11-新品上市/女-服饰.png", lambda: b"timeout"),
                  ("11-新品上市/男-鞋履.png", lambda: b"blank")]
        mapping = {"8-限时闪购/限时闪购.jpg": ("限时闪购 / 限时闪购", 1),
                   "11-新品上市/女-服饰.png": ("新品上市 / 女子 / 服饰", 1), "11-新品上市/男-鞋履.png": ("新品上市 / 男子 / 鞋履", 1)}
        with patch.object(price_check, "ocr_image", fake_ocr), _assign(mapping):
            result = asyncio.run(price_check.run_check(images, [flash, new]))
        groups = {g["分组"]: g for g in price_check.coverage([flash, new], result)}
        self.assertEqual(groups["限时闪购 / 限时闪购"]["结果"], "核对无误")
        self.assertEqual((groups["新品上市 / 女子 / 服饰"]["结果"], groups["新品上市 / 女子 / 服饰"]["原因"]),
                         ("没有核对", "图片 11-新品上市/女-服饰.png 识别失败"))
        self.assertEqual(groups["新品上市 / 男子 / 鞋履"]["原因"], "图片 11-新品上市/男-鞋履.png 上没识别出商品")
        self.assertEqual(price_check.coverage_summary(list(groups.values())), "表格这次涉及 3 组：1 组核对无误，2 组没有核对")
        # 用户点名了工作表：这张表的每一组都要交代，即使文件夹里一张对应的图都没有
        with patch.object(price_check, "ocr_image", fake_ocr), _assign():
            named = asyncio.run(price_check.run_check(images[:1], [new]))
        named_groups = {g["分组"]: g for g in price_check.coverage([new], named, whole_sheets=True)}
        self.assertEqual({g["结果"] for g in named_groups.values()}, {"没有核对"})
        self.assertEqual(len(named_groups), 2)

    def test_assignment_failures_are_reported_not_skipped(self):
        # 审核复现：分组判断失败的图要单独标出来（没有核对），不能和"模型判断不对应表格"混在一起
        sheets = price_check.load_table(_xlsx(), "a.xlsx")

        async def fake_ocr(data):
            return [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]

        async def fake_assign(folder, entries, catalog, others=None, dates=None):
            group = next(g for g in catalog if g["name"] == "TOP榜单 / 男子 / 羽绒服TOP榜")
            return {"ok.jpg": {"group": group, "start": 1, "reason": "文件名"},
                    "lost.jpg": {"group": None, "start": 1, "reason": "判断对应分组失败：模型服务异常：超时", "error": True},
                    "nav.jpg": {"group": None, "start": 1, "reason": "导航图"}}
        with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "assign_groups", fake_assign):
            result = asyncio.run(price_check.run_check(
                [("ok.jpg", lambda: b"1"), ("lost.jpg", lambda: b"2"), ("nav.jpg", lambda: b"3")], sheets))
        self.assertEqual({a["image"]: a["status"] for a in result["assigned"]},
                         {"ok.jpg": "read", "lost.jpg": "unassigned", "nav.jpg": "skipped"})
        self.assertEqual(result["unassigned"], ["lost.jpg：判断对应分组失败：模型服务异常：超时"])
        self.assertEqual([r["item"]["_image"] for r in result["records"]], ["ok.jpg"])

    def test_group_with_only_kv_rows_is_in_the_conclusion(self):
        # 正式路径复现：越冬服饰 KV 组只有不带价格的商品，图上"珑壳"印成"琥壳"，
        # 问题图片里有它，分组结论里也必须有它（不能显示"9 组有问题"却列出 10 张问题图）
        winter = price_check._sheet_rows("绒暖越冬-服饰", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
                                                        ["KV", "加绒外套", "K1", "珑壳 加绒防泼水外套", None, None],
                                                        ["KV", "加绒裤装", "K2", "加绒保暖 直筒宽松卫裤", None, None]])

        async def fake_ocr(data):
            return [{"name": {b"coat": "琥壳 加绒防泼水外套", b"pants": "加绒保暖 直筒宽松卫裤"}[data]}]

        async def no(data, pairs):
            return [False] * len(pairs)

        with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "verify_wording", no), \
                _assign({"加绒外套.jpg": ("绒暖越冬-服饰 / KV / 加绒外套", 1), "加绒裤装.jpg": ("绒暖越冬-服饰 / KV / 加绒裤装", 1)}):
            result = asyncio.run(price_check.run_check([("加绒外套.jpg", lambda: b"coat"), ("加绒裤装.jpg", lambda: b"pants")],
                                                       [winter]))
        self.assertEqual([(r["row"]["sku"], r["status"] != "一致") for r in result["records"]], [("K1", True), ("K2", False)])
        groups = price_check.coverage([winter], result)
        self.assertEqual([(g["分组"], g["结果"], g["表格里有价格的商品数"], g.get("KV 位有问题的商品数")) for g in groups],
                         [("绒暖越冬-服饰 / KV / 加绒外套", "有问题", 0, 1), ("绒暖越冬-服饰 / KV / 加绒裤装", "核对无误", 0, None)])

    def test_misread_numbers_are_dropped_or_reread(self):
        # 立省的数字被又填进吊牌价：吊牌价不可能小于等于到手价，直接丢弃
        self.assertIsNone(price_check.sanitize_item({"price": 360, "save": 539, "tag_price": 539})["tag_price"])
        self.assertEqual(price_check.sanitize_item({"price": 360, "save": 539, "tag_price": 899})["tag_price"], 899)
        # 金额读成"¥559""￥ 1999""300元"的去掉符号，报出来的读数统一
        self.assertEqual(price_check.sanitize_item({"price": "¥559", "save": "300元", "tag_price": "￥ 1999"}),
                         {"price": "559", "save": "300", "tag_price": "1999"})
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        reads = {b"flaky": iter([[{"name": "火锅羽绒 短羽绒服", "price": 899, "save": 500}],   # 第一遍把价格读错
                                 [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]]),
                 b"wrong": iter([[{"name": "拒水防泼 面包羽绒", "price": 341, "save": 271}]] * 2)}  # 两遍都是 271：真的错

        async def fake_ocr(data):
            return next(reads[data])

        images = [("a/1.jpg", lambda: b"flaky"), ("b/1.jpg", lambda: b"wrong")]
        with patch.object(price_check, "ocr_image", fake_ocr), _assign({"a/1.jpg": ("TOP榜单 / 男子 / 羽绒服TOP榜", 1), "b/1.jpg": ("TOP榜单 / 男子 / 羽绒服TOP榜", 2)}):
            result = asyncio.run(price_check.run_check(images, sheets))
        status = {r["row"]["sku"]: (r["status"], r["problems"]) for r in result["records"]}
        self.assertEqual(status["A1-1"], ("一致", []))
        self.assertEqual(status["A2-1"], ("不一致", ["立省：表格 458，图上 271"]))

    def test_reread_never_confirms_with_a_neighbours_numbers(self):
        # 注入错误测试复现：相邻两个商品的到手价放反了（表格 479/719，图上 719/479）。
        # 第二遍多读出一张不带价格的 KV 大图，位置错开一位；"高蓬锁暖羽绒服"和"保暖短羽绒服"名称又很像，
        # 不能拿隔壁商品的 719 当作"第一遍读错"，两个位置都要报出来
        sheet = price_check._sheet_rows("新品上市", [["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
                                                ["儿童", 1, "K1", "保暖短羽绒服", 180, 479],
                                                ["儿童", 2, "K2", "高蓬锁暖羽绒服", 120, 719]])
        first = [{"name": "保暖短羽绒服", "price": 719, "save": 180}, {"name": "高蓬锁暖羽绒服", "price": 479, "save": 120}]
        second = [{"name": "男大童中羽绒服"}] + first
        reads = iter([first, second, second])

        async def fake_ocr(data):
            return next(reads)

        async def no(data, pairs):
            return [False] * len(pairs)

        with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "verify_wording", no), \
                _assign(default="新品上市 / 儿童"):
            result = asyncio.run(price_check.run_check([("童-服饰.png", lambda: b"x")], [sheet]))
        prices = {r["row"]["sku"]: [p for p in r["problems"] if p.startswith("到手价")] for r in result["records"]}
        self.assertEqual(prices, {"K1": ["到手价：表格 479，图上 719"], "K2": ["到手价：表格 719，图上 479"]})

    def test_wording_is_cleared_only_when_recheck_and_reread_agree(self):
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        first = [{"name": "万龙甲防暴风冲锋衣", "price": 499, "save": 300}]

        async def run(reread_name):
            reads = iter([first, [{"name": reread_name, "price": 499, "save": 300}]])

            async def fake_ocr(data):
                return next(reads)

            async def says_table_wording(data, pairs):
                return [True] * len(pairs)

            with patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "verify_wording", says_table_wording), \
                    _assign(default="TOP榜单 / 男子 / 外套TOP榜"):
                return (await price_check.run_check([("外套/1.jpg", lambda: b"x")], sheets))["records"][0]["status"]

        # 复核说是表格的写法，但重新读图还是"防暴风"：保留提示（真的写错了）
        self.assertEqual(asyncio.run(run("万龙甲防暴风冲锋衣")), "文案待确认")
        # 复核和重新读图都是表格的写法：第一遍认错了字，不报
        self.assertEqual(asyncio.run(run("万龙甲防暴雨冲锋衣")), "一致")

    def test_missed_second_line_is_cleared_by_reread(self):
        sheets = price_check.load_table(_xlsx(), "a.xlsx")
        reads = iter([[{"name": "火锅羽绒", "price": 399, "save": 500}],            # 第一遍漏读了第二行
                      [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]])

        async def fake_ocr(data):
            return next(reads)

        with patch.object(price_check, "ocr_image", fake_ocr), _assign(default="TOP榜单 / 男子 / 羽绒服TOP榜"):
            result = asyncio.run(price_check.run_check([("a/1.jpg", lambda: b"x")], sheets))
        self.assertEqual(result["records"][0]["status"], "一致")

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


class CardTest(unittest.TestCase):
    def test_card_puts_table_values_next_to_the_image(self):
        from backend import price_cards
        if not price_cards.font_path():
            self.skipTest("本机没有中文字体")
        buf = io.BytesIO()
        Image.new("RGB", (200, 340), (200, 30, 30)).save(buf, format="JPEG")
        issues = [{"pos": 8, "sku": "AGCW403-1", "name": "砂砾鞋 WNTR加绒鞋", "where": "限时闪购",
                   "diffs": [{"kind": "价格", "label": "立省", "table": "104", "image": "271"},
                             {"kind": "文案", "label": "文案", "table": "万龙甲防暴雨冲锋衣" * 3, "image": "万龙甲防暴风冲锋衣" * 3}],
                   "same": [("到手价", "445")]}]
        with Image.open(io.BytesIO(price_cards.render_card(buf.getvalue(), "素材库/活动/1.jpg", issues))) as card:
            self.assertEqual(card.width, 400 + 28 * 2 + 640)  # 小图放大两倍，右边是对照栏
            self.assertGreaterEqual(card.height, 680 + 56)
            self.assertEqual(card.getpixel((30, 30))[0] > 150, True)   # 左边是原图
            self.assertEqual(card.getpixel((card.width - 5, 5)), (249, 250, 251))  # 右边是对照栏底色
        ok = [{"pos": 1, "sku": "AGCW401-1", "name": "曲奇鞋", "diffs": [], "same": []}]
        with Image.open(io.BytesIO(price_cards.render_card(buf.getvalue(), "x.jpg", ok + issues, ["F9-1 没上图的商品"]))) as listed:
            self.assertGreater(listed.height, 680)  # 无误的商品、没在图上找到的商品也都列出来
        many = issues * 12  # 问题很多时卡片跟着变高，不截断
        with Image.open(io.BytesIO(price_cards.render_card(buf.getvalue(), "x.jpg", many))) as tall:
            self.assertGreater(tall.height, 2000)


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
        # 直接给一张图的路径：只核对这一张；类型不对的文件不当作图片
        _shown, one, _more = shared_folders.find_files(self.user, "素材库/temp/改价/TOP榜/男子-5.jpg",
                                                       shared_folders.IMAGE_SUFFIXES, 100)
        self.assertEqual([rel for rel, _p in one], ["男子-5.jpg"])
        with self.assertRaises(shared_folders.SharedFolderError):
            shared_folders.find_files(self.user, "素材库/temp/改价/铺品.xlsx", shared_folders.IMAGE_SUFFIXES, 100)

    def _links_setup(self):
        outside = Path(self.tmp.name) / "outside"
        (outside / "deep").mkdir(parents=True)
        (outside / "secret.csv").write_text("机密", encoding="utf-8")
        Image.new("RGB", (300, 300)).save(outside / "deep" / "secret.png")
        base = self.root / "temp" / "改价"
        return outside, base

    def test_links_pointing_outside_are_never_listed_or_read(self):
        outside, base = self._links_setup()
        (base / "外部文件.csv").symlink_to(outside / "secret.csv")
        (base / "外部目录").symlink_to(outside, target_is_directory=True)
        self._assert_nothing_outside(base)

    @unittest.skipUnless(os.name == "nt", "目录联接（junction）只有 Windows 有")
    def test_windows_junction_pointing_outside_is_skipped(self):
        import _winapi
        outside, base = self._links_setup()
        _winapi.CreateJunction(str(outside), str(base / "外部联接"))
        self._assert_nothing_outside(base)

    def _assert_nothing_outside(self, base):
        # 直接指到一个链到外面的文件，也不能读
        with self.assertRaises(shared_folders.SharedFolderError):
            shared_folders.find_files(self.user, "素材库/temp/改价/外部文件.csv", shared_folders.TABLE_SUFFIXES, 100)
        for suffixes in (shared_folders.TABLE_SUFFIXES, shared_folders.IMAGE_SUFFIXES):
            _shown, found, _more = shared_folders.find_files(self.user, "素材库/temp/改价", suffixes, 100)
            for rel, path in found:
                self.assertTrue(path.resolve().is_relative_to(self.root.resolve()), rel)
                self.assertNotIn("secret", rel)
        listed = json.dumps(shared_folders.list_folder(self.user, "素材库/temp/改价"), ensure_ascii=False)
        self.assertNotIn("secret", listed)
        self.assertNotIn("deep", listed)

    def test_links_inside_the_root_still_work_and_loops_stop(self):
        base = self.root / "temp" / "改价"
        (base / "男装快捷方式").symlink_to(base / "TOP榜" / "男子", target_is_directory=True)
        (base / "TOP榜" / "绕回去").symlink_to(base, target_is_directory=True)  # 链接循环
        _shown, found, _more = shared_folders.find_files(self.user, "素材库/temp/改价", shared_folders.IMAGE_SUFFIXES, 100)
        names = [rel for rel, _p in found]
        # 同一个实际目录只进一次：男子文件夹不管经过哪条路都只出现一次，也不会因为循环停不下来
        self.assertEqual(sum(rel.endswith("羽绒服.PNG") for rel in names), 1)
        self.assertEqual(len(names), 7)
        shared_folders.list_folder(self.user, "素材库/temp/改价")

    def test_large_images_are_listed_largest_first(self):
        base = self.root / "temp" / "改价" / "TOP榜"
        (base / "大图.jpg").write_bytes(b"x" * (1024 * 1024 + 1))   # 刚好超过 1 MB
        (base / "男子" / "超大.png").write_bytes(b"x" * (3 * 1024 * 1024))
        (base / "正好1M.jpg").write_bytes(b"x" * (1024 * 1024))     # 等于 1 MB 不算超过
        result = shared_folders.large_images(self.user, "素材库/temp/改价", 1)
        self.assertEqual([(i["path"], i["size"]) for i in result["images"]],
                         [("TOP榜/男子/超大.png", "3.00 MB"), ("TOP榜/大图.jpg", "1.00 MB")])
        self.assertEqual(result["over_limit"], 2)
        self.assertEqual(result["images_checked"], 10)  # 原有 7 张 + 新加 3 张
        self.assertIn("1 MB = 1024 KB", result["rule"])

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
                    patch.object(price_check, "ocr_image", fake_ocr), _assign(default="TOP榜单 / 男子 / 羽绒服TOP榜"):
                overview = asyncio.run(shared_tools.read_table(ctx, {}))  # 不填 source：用对话里上传的表格
                for early in ({"folder": "Z:\\活动"}, {"folder": "Z:\\活动", "request": "smb://192.168.1.2/素材库/活动"},
                              {"folder": "Z:\\活动", "request": "铺品.xlsx"}):
                    self.assertIn("还没有提出核对要求", asyncio.run(shared_tools.check_prices(ctx, early))["error"])
                result = asyncio.run(shared_tools.check_prices(ctx, {"folder": "Z:\\活动", "request": "核对一下价格文案信息是否有误"}))
            # 发错了表格：没有一张图对应得上，要告诉用户表格里是哪些分组，提醒可能发错了
            kept = len(events)
            with patch.object(shared_folders.settings, "shared_folders_path", config), \
                    patch.object(price_check, "ocr_image", fake_ocr), _assign(default=None):
                wrong = asyncio.run(shared_tools.check_prices(ctx, {"folder": "Z:\\活动", "request": "核对一下价格文案信息是否有误"}))
            del events[kept:]  # 下面只检查第一次核对的进度消息
            # 审核复现：判断对应分组的模型线路全部失败，不能说成"可能发错了表格"，要说清没有核对、结果不完整
            kept = len(events)

            async def broken(*args, **kwargs):
                raise RuntimeError("线路断开")
            with patch.object(shared_folders.settings, "shared_folders_path", config), \
                    patch.object(price_check, "ocr_image", fake_ocr), patch.object(price_check, "routed_chat_completion", broken):
                down = asyncio.run(shared_tools.check_prices(ctx, {"folder": "Z:\\活动", "request": "核对一下价格文案信息是否有误"}))
            del events[kept:]
            self.assertIn("判断对应分组失败", down["结论"])
            self.assertIn("结果不完整", down["结论"])
            self.assertEqual(down["概况"]["判断对应分组失败、没有核对的图片数"], 1)
            self.assertTrue(any("不代表它们和表格无关" in n and "男子/羽绒服.png" in n for n in down["说明"]))
            self.assertFalse(any("发错了表格" in n for n in down["说明"]))
            self.assertEqual(wrong["结论"], "没有核对到表格里的任何一组")
            self.assertTrue(any("可能表格和文件夹不是同一个活动" in n and "TOP榜单 / 男子 / 羽绒服TOP榜" in n for n in wrong["说明"]))
            self.assertEqual([s["sheet"] for s in overview["sheets"]], ["TOP榜单", "新品上市"])
            self.assertEqual((result["checked"], result["counts"]["不一致"]), (1, 1))
            messages = [a[1]["message"] for a in events if a[0] == "tool.progress"]
            self.assertTrue(messages[0].startswith("正在读取表格"))
            self.assertTrue(any(m.startswith("正在识别图片") for m in messages))  # 同一阶段每秒最多一条
            self.assertTrue(messages[-1].startswith("正在生成 1 张核对卡片"))
            # 结果按图片归类，同一张图的问题放一起，并带上核对卡片
            (found,) = result["有问题的图片"]
            self.assertEqual(found["图片"], "男子/羽绒服.png")
            self.assertEqual(found["问题"][0]["差异"], [{"类型": "价格", "项目": "立省", "表格": "500", "图上": "271"}])
            self.assertEqual(found["问题"][0]["结论"], "不一致")  # 和"文案待确认"区分开，回复时分开说
            self.assertIn("文案待确认", result["回复要求"])
            # 以表格为准按分组交代：有图对应到的分组都说清楚查没查
            groups = {g["分组"]: g for g in result["各分组核对情况"]}
            checked = groups["TOP榜单 / 男子 / 羽绒服TOP榜"]
            self.assertEqual((checked["结果"], checked["核对到的商品数"], checked["有问题的商品数"]), ("有问题", 1, 1))
            self.assertEqual(checked["没核对到的商品"], ["A2-1 拒水防泼 面包羽绒"])
            # 同一张表里没有任何图对应到的分组不算进结论（用户可能只给了一个子文件夹），单独列出来提一句
            self.assertEqual(list(groups), ["TOP榜单 / 男子 / 羽绒服TOP榜"])
            self.assertEqual(result["结论"], "表格这次涉及 1 组：1 组有问题")
            self.assertEqual(result["这次文件夹里没有对应图片的分组"],
                             ["TOP榜单 / 男子 / 外套TOP榜", "TOP榜单 / 女子 / 羽绒服TOP榜", "TOP榜单 / 儿童 / 羽绒服TOP榜"])
            self.assertNotIn("11.10新品上市 / 男子 / 服饰", result["这次文件夹里没有对应图片的分组"])  # 没涉及的表不列
            self.assertNotIn("files", result)  # 不再生成 Excel 对比表
            self.assertNotIn("图上有价格但表格里没有的商品", result)  # 以表格为准，图上多出来的不报
            (card,) = result["images"]
            self.assertEqual(card["id"], found["核对卡片"])
            saved = store.get_artifact(card["id"], "u1")
            self.assertTrue(Path(saved["path"]).is_relative_to(Path(tmp) / "out"))  # 卡片写在本机输出目录
            with Image.open(saved["path"]) as picture:
                self.assertGreater(picture.width, 720)  # 原图旁边多出一栏对照
            self.assertEqual(sorted(p.name for p in (root / "活动").rglob("*")), ["男子", "羽绒服.png"])  # 共享盘没多出文件
            self.assertIn(("publish", "artifact.created"), events)
            # 表格截图 + 直接上传到对话里的图片：没有共享文件夹也能核对
            buf = io.BytesIO()
            Image.new("RGB", (800, 600)).save(buf, format="PNG")
            shot = service.save_upload(user, session["id"], buf.getvalue(), "表格截图.png")
            poster = service.save_upload(user, session["id"], buf.getvalue(), "海报.png")

            async def fake_table_image(data):
                return price_check.load_table(_xlsx(), "a.xlsx")[:1]

            with patch.object(price_check, "ocr_image", fake_ocr), _assign(default="TOP榜单 / 男子 / 羽绒服TOP榜"), \
                    patch.object(price_check, "load_table_image", fake_table_image):
                uploaded = asyncio.run(shared_tools.check_prices(ctx, {
                    "request": "核对一下价格", "table": shot["id"], "image_ids": [shot["id"], poster["id"]]}))
            self.assertEqual((uploaded["概况"]["文件夹里的图片数"], uploaded["概况"]["核对结果"]["价格不一致"]), (1, 1))

            # 线上出过的情况：给了共享文件夹，表格只有一张截图，模型把截图当成"要核对的图"放进 image_ids、没填 table
            fresh = store.create_session("u1")  # 这个会话里没有上传过 Excel
            shot = service.save_upload(user, fresh["id"], buf.getvalue(), "表格截图.png")
            poster = service.save_upload(user, fresh["id"], buf.getvalue(), "海报.png")
            ctx = ToolContext(user=user, session_id=fresh["id"], turn_id="t2", call_id="c2", emit=emit, state={},
                              publish=publish)
            with patch.object(shared_folders.settings, "shared_folders_path", config), \
                    patch.object(price_check, "ocr_image", fake_ocr), _assign(default="TOP榜单 / 男子 / 羽绒服TOP榜"), \
                    patch.object(price_check, "load_table_image", fake_table_image):
                guessed = asyncio.run(shared_tools.check_prices(ctx, {
                    "request": "根据表格检查一下价格文案", "folder": "Z:\\活动", "image_ids": [shot["id"]]}))
                self.assertEqual(guessed["概况"]["文件夹里的图片数"], 1)  # 截图当表格用，没被当成要核对的图
                self.assertEqual(guessed["概况"]["表格"], "表格截图.png")  # 显示用户上传时的文件名
                self.assertEqual(guessed["概况"]["核对结果"]["价格不一致"], 1)
                # 贴了两张图又没说哪张是表格：问清楚，不乱猜
                with self.assertRaisesRegex(ValueError, "哪张是表格截图"):  # 引擎会把异常转成工具错误交给模型
                    asyncio.run(shared_tools.check_prices(ctx, {
                        "request": "核对一下", "folder": "Z:\\活动", "image_ids": [shot["id"], poster["id"]]}))
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

        with patch.object(price_check, "ocr_image", fake_ocr), _assign(default="表格截图 / 限时闪购"):
            result = asyncio.run(price_check.run_check([("a.png", lambda: b"x")], sheets))
        self.assertEqual(result["records"][0]["problems"], ["立省：表格 539，图上 500"])


if __name__ == "__main__":
    unittest.main()


class TableUploadRouteTest(unittest.TestCase):
    """只带表格、不写文字也能发；表格处理在工作线程里跑，不卡住其他请求。"""

    def test_table_only_message_is_processed_off_the_event_loop(self):
        import threading
        import time as time_module
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from backend import job_store
        from backend.agent2 import routes, service, store
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(job_store, "_DB_PATH", Path(tmp) / "a2.db"), \
                patch.object(service.settings, "output_path", Path(tmp) / "out"):
            job_store.init_db()
            store.init_tables()
            user = {"id": "u1", "username": "tester"}
            session = store.create_session("u1")
            upload = MagicMock()
            upload.filename = "铺品.xlsx"

            async def read(n=-1):
                return _xlsx()
            upload.read = read
            threads, started = [], []

            def slow_slim(data, filename):  # 模拟大表格处理很慢
                threads.append(threading.current_thread() is threading.main_thread())
                time_module.sleep(0.3)
                return data

            async def fake_start_turn(user_, session_, text, uploads, **kwargs):
                started.append((text, [(u["kind"], u["label"]) for u in uploads]))
                yield "data: {}\n\n"

            async def scenario():
                ticks = 0

                async def other_requests():  # 其他用户的请求：表格处理期间要能照常执行
                    nonlocal ticks
                    for _ in range(5):
                        await asyncio.sleep(0.05)
                        ticks += 1

                response, _ = await asyncio.gather(
                    routes.send_message(SimpleNamespace(state=SimpleNamespace(user=user)), session["id"],
                                        message="", skill="", images=[], files=[upload], character_ids=""),
                    other_requests())
                async for _chunk in response.body_iterator:
                    pass
                return ticks

            with patch.object(service, "slim_table", slow_slim), patch.object(service, "start_turn", fake_start_turn):
                ticks = asyncio.run(scenario())
            self.assertEqual(threads, [False])           # 表格处理不在主线程（事件循环）里
            self.assertEqual(ticks, 5)                   # 处理期间其他协程照常运行
            self.assertEqual(started, [("", [("table", "铺品.xlsx")])])  # 没有文字也发出去了


class AnswerWithAttachmentsTest(unittest.TestCase):
    """Agent 在等用户回答（例如问"请提供铺品表"）时，回答里附的表格要真的送到，不能被丢掉。"""

    def setUp(self):
        from types import SimpleNamespace
        from backend import job_store
        from backend.agent2 import service, store
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(job_store, "_DB_PATH", Path(self.tmp.name) / "a2.db"),
                        patch.object(service.settings, "output_path", Path(self.tmp.name) / "out")]
        for p in self.patches:
            p.start()
        job_store.init_db()
        store.init_tables()
        self.store = store
        self.user = {"id": "u1", "username": "tester"}
        self.request = SimpleNamespace(state=SimpleNamespace(user=self.user))
        self.session = store.create_session("u1")
        # 一轮正在等用户回答 ask_user 的提问
        turn = store.claim_turn(self.session["id"], "u1", "核对一下价格")
        store.update_turn(turn["id"], status="waiting_user",
                          engine_state={"pending": {"call_id": "call_ask", "question": "请提供铺品表"}})
        self.turn = turn

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def _upload(self, data, name):
        from unittest.mock import MagicMock
        upload = MagicMock()
        upload.filename = name

        async def read(n=-1):
            return data
        upload.read = read
        return upload

    def _answer(self, text, files):
        from backend.agent2 import routes, service
        seen = {}

        async def fake_drive(*, messages, **kwargs):
            seen["tool_reply"] = json.loads(messages[-1]["content"])["answer"]
            yield "data: {}\n\n"

        async def run():
            response = await routes.answer(self.request, self.turn["id"], answer=text, images=[], files=files)
            async for _chunk in response.body_iterator:
                pass

        with patch.object(service, "_drive", fake_drive), patch.object(service, "slim_table", lambda d, n: d):
            asyncio.run(run())
        events = [e for e in self.store.list_events(self.session["id"]) if e["type"] == "input.answered"]
        return seen["tool_reply"], events[-1]["payload"]

    def _table_id(self):
        return next(a["id"] for a in self.store.list_artifacts(self.session["id"]) if a["kind"] == "table")

    def test_table_only_answer_reaches_the_model(self):
        reply, payload = self._answer("", [self._upload(_xlsx(), "铺品.xlsx")])
        self.assertIn(f"[用户上传了表格：{self._table_id()}（铺品.xlsx）]", reply)
        self.assertEqual([(u["kind"], u["name"]) for u in payload["uploads"]], [("table", "铺品.xlsx")])
        self.assertEqual(payload["answer"], "")

    def test_text_and_table_answer_keeps_both(self):
        reply, payload = self._answer("这是表格，核对适温叠穿那页", [self._upload(_xlsx(), "铺品.xlsx")])
        self.assertTrue(reply.startswith("这是表格，核对适温叠穿那页"))
        self.assertIn(self._table_id(), reply)
        self.assertEqual(payload["answer"], "这是表格，核对适温叠穿那页")

    def test_invalid_attachment_does_not_consume_the_question(self):
        from fastapi import HTTPException
        from backend.agent2 import routes
        with self.assertRaises(HTTPException):
            asyncio.run(routes.answer(self.request, self.turn["id"], answer="", images=[],
                                      files=[self._upload(b"x", "说明.docx")]))
        # 校验失败不占用这一轮：用户改正后还能继续回答
        self.assertTrue(self.store.claim_answer(self.turn["id"], "u1"))


class SlowShareTest(unittest.TestCase):
    """共享盘慢的时候（文件多、网络延迟、SMB 断开），核对任务可以慢，但不能卡住同一后端的其他请求。"""

    def test_slow_share_scan_does_not_block_other_requests(self):
        import time as time_module
        from backend import job_store
        from backend.agent2 import service, shared_tools, store
        from backend.agent2.engine import ToolContext
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(job_store, "_DB_PATH", Path(tmp) / "a2.db"), \
                patch.object(service.settings, "output_path", Path(tmp) / "out"):
            job_store.init_db()
            store.init_tables()
            root = Path(tmp) / "share"
            (root / "活动").mkdir(parents=True)
            Image.new("RGB", (720, 940)).save(root / "活动" / "1.png")
            config = Path(tmp) / "shared.json"
            config.write_text(json.dumps([{"name": "素材库", "path": str(root)}]), encoding="utf-8")
            session = store.create_session("u1")
            user = {"id": "u1"}
            buf = io.BytesIO()
            Image.new("RGB", (800, 600)).save(buf, format="PNG")
            shot = service.save_upload(user, session["id"], buf.getvalue(), "表格截图.png")
            real_find = shared_folders.find_files
            scans = []

            def slow_find(*args, **kwargs):  # 每次扫共享盘都要 0.3 秒
                scans.append(args[2] == shared_folders.TABLE_SUFFIXES)
                time_module.sleep(0.3)
                return real_find(*args, **kwargs)

            async def fake_table_image(data):
                return price_check.load_table(_xlsx(), "a.xlsx")[:1]

            async def fake_ocr(data):
                return [{"name": "火锅羽绒 短羽绒服", "price": 399, "save": 500}]

            async def emit(*_):
                pass

            ctx = ToolContext(user=user, session_id=session["id"], turn_id="t", call_id="c", emit=emit, state={})

            async def scenario():
                ticks = []
                start = time_module.monotonic()

                async def other_request():  # 其他用户的请求：每 50ms 要执行一次
                    for _ in range(12):
                        await asyncio.sleep(0.05)
                        ticks.append(time_module.monotonic() - start)

                result, _ = await asyncio.gather(
                    shared_tools.check_prices(ctx, {"request": "根据表格检查价格", "folder": "素材库/活动",
                                                    "image_ids": [shot["id"]]}),
                    other_request())
                return result, ticks

            with patch.object(shared_folders.settings, "shared_folders_path", config), \
                    patch.object(shared_folders, "find_files", slow_find), \
                    patch.object(price_check, "ocr_image", fake_ocr), _assign(default="TOP榜单 / 男子 / 羽绒服TOP榜"), \
                    patch.object(price_check, "load_table_image", fake_table_image):
                result, ticks = asyncio.run(scenario())
            self.assertIn(True, scans)  # 确实走了"扫共享盘找表格"这一步
            self.assertEqual(result["概况"]["表格"], "表格截图.png")
            # 扫描期间其他协程照常每 50ms 运行一次，最长间隔远小于一次扫描的 0.3 秒
            gaps = [b - a for a, b in zip([0.0] + ticks, ticks)]
            self.assertLess(max(gaps), 0.2, gaps)
