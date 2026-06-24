# Chatbot 表格解析生成 JSON PRD

## 1. 项目背景

当前电商渠道快速换品改价格流程依赖 Photoshop 脚本“ 小变量 ”手动执行：

1. 用户整理 Excel 表格。
2. 用户从表格复制字段。
3. 用户回到 Photoshop，粘贴字段到小变量输入框。
4. 小变量按 PSD/PSB 中红色标记图层顺序替换图片和文本。

新流程希望把“从 Excel 复制字段”的工作交给内网 Chatbot。

Chatbot 接收用户上传的 Excel，解析可出图的 Sheet、模块、字段、颜色标记和素材类型，最终返回一段标准 JSON。用户复制 JSON 到 Photoshop 小变量输入框，小变量根据 JSON 自动执行替换与导出。

本 PRD 重点描述 Chatbot 端需要开发的功能、交互流程和 JSON 输出标准。

## 2. Chatbot 端目标

### 2.1 核心目标

- 用户上传 Excel 后，Chatbot 自动识别可处理的 Sheet。
- Chatbot 自动识别每个 Sheet 中的模块范围。
- Chatbot 根据模板规则生成替换字段序列。
- Chatbot 支持和用户交互确认图片素材类型。
- Chatbot 支持识别 SKU 后缀，自动覆盖素材类型。
- Chatbot 支持识别黄色标记，生成增量修改 JSON。
- Chatbot 最终输出 Photoshop 小变量可消费的标准 JSON。

### 2.2 用户体验目标

用户期望流程：

```text
用户上传 Excel
-> Chatbot 解析并展示检测结果
-> Chatbot 询问每个模板默认图片类型
-> 用户确认
-> Chatbot 输出 JSON
-> 用户复制 JSON 到 Photoshop
```

第二次少量修改流程：

```text
用户在 Excel 中把修改字段标黄
-> 上传给 Chatbot
-> Chatbot 识别黄色字段
-> 输出 patch JSON
-> 用户复制到 Photoshop
-> 只修改对应槽位
```

## 3. 非目标

- Chatbot 不直接操作 Photoshop。
- Chatbot 不读取 PSD/PSB 图层。
- Chatbot 不判断 PSD 中红色图层数量是否真实匹配。
- Chatbot 不导出图片。
- Chatbot 不承担 Photoshop 小变量现有手动模式的逻辑。

## 4. 基础概念

### 4.1 Sheet 与模板

默认规则：

```text
Excel Sheet 名 = 模板文件名
```

示例：

```text
Sheet 名：假期榜单
模板文件：假期榜单.psb / 假期榜单.psd
```

Chatbot 只需要输出 `templateName`，不需要确认本地文件是否存在。

### 4.2 模块

Excel 中 `模块` 字段表示业务模块，例如：

```text
男子
女子
小童
精选鞋履
潮流服饰
```

默认规则：

```text
Excel 模块名 = PSD/PSB 中的分组名
```

### 4.3 槽位 slotIndex

小变量会按 PSD 分组内红色标记图层顺序替换。

Chatbot 需要根据字段展开顺序计算 `slotIndex`。

示例：

```text
字段顺序：SKU, 商品名称, 立省, 到手价
模块内 9 个商品
总槽位数：9 * 4 = 36
```

展开结果：

```text
第 1 条商品 SKU       -> slotIndex 1
第 1 条商品 商品名称  -> slotIndex 2
第 1 条商品 立省      -> slotIndex 3
第 1 条商品 到手价    -> slotIndex 4
第 2 条商品 SKU       -> slotIndex 5
...
```

## 5. Excel 解析功能

### 5.1 过滤 Sheet

默认只处理可见 Sheet。

要求：

- 跳过 `hidden` Sheet。
- 跳过 `veryHidden` Sheet。
- 可见 Sheet 进入解析候选。

如果没有可见 Sheet，应提示用户：

```text
未检测到可处理的可见 Sheet，请检查表格是否隐藏了工作表。
```

### 5.2 识别表头

Chatbot 应自动识别表头行。

核心字段包括：

```text
模块
SKU / sku
商品名称
立省
到手价
```

字段名需要做归一化：

- 去除前后空格。
- 支持大小写差异，例如 `SKU` / `sku`。
- 支持常见别名，见模板规则库。

### 5.3 识别模块范围

优先通过 `模块` 列的合并单元格识别模块范围。

示例：

```text
A2:A10 = 男子
A11:A19 = 女子
```

应解析为：

```json
[
  {
    "moduleName": "男子",
    "excelRange": "A2:H10",
    "rowStart": 2,
    "rowEnd": 10,
    "rowCount": 9
  },
  {
    "moduleName": "女子",
    "excelRange": "A11:H19",
    "rowStart": 11,
    "rowEnd": 19,
    "rowCount": 9
  }
]
```

如果 `模块` 列没有合并单元格，则使用向下填充逻辑：

```text
模块列有值时开启新模块
模块列为空时继承上一行模块
```

### 5.4 过滤行

默认过滤：

- 隐藏行。
- 空 SKU 行。
- 完全空行。
- 明显错误值行，例如关键字段为 `#N/A`。

是否下架字段处理建议：

- 如果存在 `是否下架` 字段且值为 `下架`，默认跳过。
- 如果值为 `上架` 或为空，默认保留。

该规则应允许在模板规则库中覆盖。

### 5.5 过滤字段

字段过滤应采用白名单，而不是黑名单。

每个模板在规则库中定义 `fieldOrder`，Chatbot 只输出这些字段。

示例：

```json
{
  "fieldOrder": ["SKU", "商品名称", "立省", "到手价"]
}
```

表格中即使存在以下字段，也不自动输出：

```text
SPU
吊牌价
库存
是否下架
主推款
```

除非它们被写入 `fieldOrder`。

## 6. 颜色标记与 patch 模式

### 6.1 颜色标记目的

颜色标记用于第二次少量修改。

用户在 Excel 中把需要改的单元格标黄，Chatbot 识别后生成 `patch` JSON，只替换指定槽位。

### 6.2 第一版颜色规则

第一版建议只支持手动填充黄色。

黄色识别范围：

- 单元格填充色为黄色。
- 支持常见黄色，如 `FFFF00`、`FFF2CC`。

暂不强制支持：

- 条件格式产生的颜色。
- 复杂主题色推导。

### 6.3 黄色单元格语义

| 标黄位置 | 语义 |
|---|---|
| 普通字段单元格标黄 | 只修改该字段 |
| SKU 单元格标黄 | 默认修改该商品的图片槽位；可按规则扩展为该商品全字段 |
| 整行标黄 | 修改该行在 `fieldOrder` 中的全部字段 |

第一版最小实现：

```text
只要 fieldOrder 中的某个单元格标黄，就输出该字段对应 patch。
```

### 6.4 full 与 patch 判断

建议 Chatbot 根据是否检测到黄色标记自动判断模式：

```text
检测到黄色标记 -> mode = patch
未检测到黄色标记 -> mode = full
```

同时允许用户在对话中覆盖：

```text
是否只生成标黄字段的增量 JSON？是 / 否
```

## 7. 图片素材类型判断

### 7.1 标准素材类型

Chatbot 输出的 `sourceType` 必须使用以下标准值：

| sourceType | 说明 |
|---|---|
| `PNG` | 普通 PNG 素材 |
| `PNG带阴影` | 阴影 PNG 素材 |
| `白底` | 白底素材 |
| `模特图` | 模特图素材 |
| `一双鞋` | 一双鞋素材 |
| `素材路径` | 使用表格中的具体素材路径 |

### 7.2 判断优先级

从高到低：

```text
1. SKU 后缀规则
2. 表格显式素材类型字段
3. 用户在 Chatbot 交互中选择
4. 模板规则库历史默认
5. 全局默认 PNG
```

### 7.3 SKU 后缀规则

Chatbot 应识别 SKU 末尾的素材类型后缀。

| 后缀 | sourceType |
|---|---|
| `-M` 或 `__M` | 模特图 |
| `-P` 或 `__P` | PNG |
| `-S` 或 `__S` | PNG带阴影 |
| `-W` 或 `__W` | 白底 |
| `-X2` 或 `__X2` | 一双鞋 |

示例：

```text
ARHW015-22-M
```

应输出：

```json
{
  "value": "ARHW015-22",
  "rawValue": "ARHW015-22-M",
  "sourceType": "模特图",
  "sourceTypeReason": "sku_suffix:-M"
}
```

注意：

- `value` 必须去掉后缀，用于 Photoshop 查找素材。
- `rawValue` 保留表格原值，用于追溯。
- 后缀只影响图片字段，不应污染文本字段。

### 7.4 同模板混用素材类型

必须支持同一个模板、同一个模块内不同商品使用不同素材类型。

示例：

```text
前 6 个 SKU 无后缀 -> 使用模板默认 PNG
后 3 个 SKU 带 -M -> 使用模特图
```

Chatbot 应在每个 image value 上写入独立 `sourceType`。

## 8. Chatbot 用户交互流程

### 8.1 第一步：上传并解析 Excel

用户上传 Excel 后，Chatbot 先返回解析摘要。

示例：

```text
已解析 DATA.xlsx。

检测到 1 个可见 Sheet：
1. 假期榜单

检测到模块：
- 男子：A2:H10，9 行，预计 36 个槽位
- 女子：A11:H19，9 行，预计 36 个槽位
- 小童：A20:H28，9 行，预计 36 个槽位

字段顺序：
SKU、商品名称、立省、到手价
```

### 8.2 第二步：确认默认素材类型

Chatbot 应根据检测到的 Sheet/templateName 询问用户默认素材类型。

示例：

```text
检测到模板「假期榜单」。
请选择该模板默认图片类型：
1. PNG
2. PNG带阴影
3. 白底
4. 模特图
5. 一双鞋
```

如果存在模板规则库默认值：

```text
检测到模板「假期榜单」，历史默认图片类型为 PNG。
是否沿用？是 / 否
```

如果有多个模板：

```text
检测到 3 个模板，请分别确认默认图片类型：
- 假期榜单：PNG
- 清凉装备：白底
- 运动场景穿搭：模特图
```

### 8.3 第三步：提示 SKU 后缀覆盖

若检测到后缀覆盖，Chatbot 应提示用户：

```text
检测到 3 个 SKU 使用后缀覆盖素材类型：
- AGCW115-1-M -> 模特图
- AGLW002-1-M -> 模特图
- ARHW018-1-W -> 白底

这些 SKU 将优先使用后缀指定的素材类型。
```

### 8.4 第四步：确认 full 或 patch

若检测到黄色标记：

```text
检测到 5 个标黄单元格。
是否生成只修改标黄字段的 patch JSON？
```

若未检测到黄色标记：

```text
未检测到标黄单元格，将生成 full JSON。
```

### 8.5 第五步：输出 JSON

输出前给出最终摘要：

```text
即将生成 JSON：
- 模式：full
- 模板：1 个
- 模块：3 个
- 替换槽位：108 个
- 默认素材类型：PNG
- 后缀覆盖：3 个
```

然后输出完整 JSON。

## 9. 模板规则库

Chatbot 应维护模板规则库，用于稳定解析字段和生成 slotIndex。

### 9.1 规则库示例

```json
{
  "templates": {
    "假期榜单": {
      "fieldOrder": ["SKU", "商品名称", "立省", "到手价"],
      "defaultSourceType": "PNG",
      "itemsPerModule": 9,
      "exportFormat": "png",
      "fieldAliases": {
        "SKU": ["SKU", "sku"],
        "商品名称": ["商品名称", "品名"],
        "立省": ["立省", "优惠", "优惠金额"],
        "到手价": ["到手价", "价格", "活动价"]
      },
      "skipIf": {
        "是否下架": ["下架"]
      }
    }
  }
}
```

### 9.2 规则库字段说明

| 字段 | 说明 |
|---|---|
| `fieldOrder` | 必填。输出字段顺序，也是 slotIndex 计算依据 |
| `defaultSourceType` | 模板默认素材类型 |
| `itemsPerModule` | 预期每个模块商品数，可用于提示异常 |
| `exportFormat` | 导出格式 |
| `fieldAliases` | 字段别名 |
| `skipIf` | 行过滤规则 |

## 10. JSON 输出标准

### 10.1 顶层结构

```json
{
  "schemaVersion": "1.0",
  "mode": "full",
  "source": {
    "fileName": "DATA.xlsx",
    "generatedAt": "2026-06-22T15:30:00+08:00",
    "generator": "internal-chatbot"
  },
  "defaults": {
    "sourceType": "PNG",
    "layerOrder": "panel",
    "savePolicy": "overwrite",
    "exportMode": "moduleGroup",
    "exportFormat": "png"
  },
  "jobs": []
}
```

### 10.2 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---:|---:|---|
| `schemaVersion` | string | 是 | 固定为 `1.0` |
| `mode` | string | 是 | `full` 或 `patch` |
| `source` | object | 是 | 来源信息 |
| `defaults` | object | 是 | 全局默认配置 |
| `jobs` | array | 是 | 每个 Sheet/template 对应一个 job |

### 10.3 Job 结构

```json
{
  "sheetName": "假期榜单",
  "templateName": "假期榜单",
  "defaultSourceType": "PNG",
  "fieldOrder": ["SKU", "商品名称", "立省", "到手价"],
  "modules": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---:|---:|---|
| `sheetName` | string | 是 | Excel Sheet 名 |
| `templateName` | string | 是 | 模板名，不含扩展名 |
| `defaultSourceType` | string | 是 | 当前模板默认素材类型 |
| `fieldOrder` | array | 是 | 字段展开顺序 |
| `modules` | array | 是 | 模块列表 |

### 10.4 Full module 结构

```json
{
  "moduleName": "男子",
  "targetGroup": "男子",
  "excelRange": "A2:H10",
  "rowCount": 9,
  "expectedLayerCount": 36,
  "exportName": "假期榜单_男子",
  "values": []
}
```

### 10.5 Patch module 结构

```json
{
  "moduleName": "男子",
  "targetGroup": "男子",
  "excelRange": "A2:H10",
  "rowCount": 9,
  "expectedLayerCount": 36,
  "exportName": "假期榜单_男子",
  "patches": []
}
```

### 10.6 Value / Patch 结构

图片：

```json
{
  "slotIndex": 1,
  "type": "image",
  "field": "SKU",
  "value": "ARHW015-22",
  "rawValue": "ARHW015-22-M",
  "sourceType": "模特图",
  "sourceTypeReason": "sku_suffix:-M",
  "rowIndexInModule": 1,
  "sourceRow": 2,
  "changed": false
}
```

文本：

```json
{
  "slotIndex": 2,
  "type": "text",
  "field": "商品名称",
  "value": "越影6 PRO缓震保护跑鞋",
  "rowIndexInModule": 1,
  "sourceRow": 2,
  "changed": false
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---:|---:|---|
| `slotIndex` | number | 是 | 从 1 开始的槽位序号 |
| `type` | string | 是 | `image` 或 `text` |
| `field` | string | 是 | 来源字段名 |
| `value` | string/number | 是 | 清洗后的替换值 |
| `rawValue` | string | 否 | Excel 原始值 |
| `sourceType` | string | 图片必填 | 图片素材类型 |
| `sourceTypeReason` | string | 否 | 素材类型来源 |
| `rowIndexInModule` | number | 是 | 模块内第几条商品 |
| `sourceRow` | number | 是 | Excel 原始行号 |
| `changed` | boolean | 否 | 是否由颜色标记触发 |

## 11. Full JSON 示例

```json
{
  "schemaVersion": "1.0",
  "mode": "full",
  "source": {
    "fileName": "DATA.xlsx",
    "generatedAt": "2026-06-22T15:30:00+08:00",
    "generator": "internal-chatbot"
  },
  "defaults": {
    "sourceType": "PNG",
    "layerOrder": "panel",
    "savePolicy": "overwrite",
    "exportMode": "moduleGroup",
    "exportFormat": "png"
  },
  "jobs": [
    {
      "sheetName": "假期榜单",
      "templateName": "假期榜单",
      "defaultSourceType": "PNG",
      "fieldOrder": ["SKU", "商品名称", "立省", "到手价"],
      "modules": [
        {
          "moduleName": "男子",
          "targetGroup": "男子",
          "excelRange": "A2:H10",
          "rowCount": 9,
          "expectedLayerCount": 36,
          "exportName": "假期榜单_男子",
          "values": [
            {
              "slotIndex": 1,
              "type": "image",
              "field": "SKU",
              "value": "ARHW015-22",
              "rawValue": "ARHW015-22",
              "sourceType": "PNG",
              "sourceTypeReason": "template_default",
              "rowIndexInModule": 1,
              "sourceRow": 2,
              "changed": false
            },
            {
              "slotIndex": 2,
              "type": "text",
              "field": "商品名称",
              "value": "越影6 PRO缓震保护跑鞋",
              "rowIndexInModule": 1,
              "sourceRow": 2,
              "changed": false
            },
            {
              "slotIndex": 3,
              "type": "text",
              "field": "立省",
              "value": "70",
              "rowIndexInModule": 1,
              "sourceRow": 2,
              "changed": false
            },
            {
              "slotIndex": 4,
              "type": "text",
              "field": "到手价",
              "value": "629",
              "rowIndexInModule": 1,
              "sourceRow": 2,
              "changed": false
            }
          ]
        }
      ]
    }
  ]
}
```

## 12. Patch JSON 示例

```json
{
  "schemaVersion": "1.0",
  "mode": "patch",
  "source": {
    "fileName": "DATA.xlsx",
    "generatedAt": "2026-06-22T16:10:00+08:00",
    "generator": "internal-chatbot"
  },
  "defaults": {
    "sourceType": "PNG",
    "layerOrder": "panel",
    "savePolicy": "overwrite",
    "exportMode": "moduleGroup",
    "exportFormat": "png"
  },
  "jobs": [
    {
      "sheetName": "假期榜单",
      "templateName": "假期榜单",
      "defaultSourceType": "PNG",
      "fieldOrder": ["SKU", "商品名称", "立省", "到手价"],
      "modules": [
        {
          "moduleName": "男子",
          "targetGroup": "男子",
          "excelRange": "A2:H10",
          "rowCount": 9,
          "expectedLayerCount": 36,
          "exportName": "假期榜单_男子",
          "patches": [
            {
              "slotIndex": 32,
              "type": "text",
              "field": "到手价",
              "value": "258",
              "rowIndexInModule": 8,
              "sourceRow": 9,
              "changed": true
            }
          ]
        }
      ]
    }
  ]
}
```

## 13. Chatbot 输出校验

Chatbot 生成 JSON 前必须自检：

- 每个 job 有 `sheetName`、`templateName`。
- 每个 job 有非空 `fieldOrder`。
- 每个 module 有 `moduleName`、`expectedLayerCount`、`exportName`。
- full 模式下每个 module 有 `values`。
- patch 模式下每个 module 有 `patches`。
- 每个 value/patch 都有 `slotIndex`。
- `slotIndex` 从 1 开始递增或能准确定位。
- `expectedLayerCount = rowCount * fieldOrder.length`，除非规则库显式覆盖。
- 图片类型 value 必须有 `sourceType`。
- SKU 后缀已从 `value` 中剥离，并保留到 `rawValue`。

## 14. 异常提示

### 14.1 未匹配规则库

如果 Sheet 名没有匹配模板规则：

```text
未找到「假期榜单」的模板规则。
请确认字段顺序，例如：SKU、商品名称、立省、到手价。
```

用户确认后，可生成临时规则。

### 14.2 模块行数异常

如果规则库期望 9 行，但实际模块为 8 行：

```text
模块「男子」检测到 8 行，规则期望 9 行。
是否继续生成 JSON？
```

### 14.3 字段缺失

如果 fieldOrder 中字段不存在：

```text
模板「假期榜单」需要字段「到手价」，但表格中未找到。
请检查表头或字段别名。
```

### 14.4 SKU 后缀无法识别

```text
检测到疑似素材后缀「-Q」，当前不支持。
将按默认素材类型处理。
```

## 15. 开发建议

### 15.1 推荐解析技术

推荐使用：

```text
Python + openpyxl
```

原因：

- 能读取隐藏 Sheet。
- 能读取合并单元格。
- 能读取行列隐藏状态。
- 能读取单元格填充色。
- 能读取公式与错误值。

如果 Chatbot 主服务是 Node.js，可由 Node 调用 Python 解析模块。

### 15.2 解析模块建议输出中间结构

建议先生成中间结构，再生成最终 JSON。

中间结构示例：

```json
{
  "sheets": [
    {
      "sheetName": "假期榜单",
      "headers": ["模块", "序号", "SKU", "商品名称", "立省", "到手价"],
      "modules": [
        {
          "moduleName": "男子",
          "rowStart": 2,
          "rowEnd": 10,
          "rows": []
        }
      ]
    }
  ]
}
```

这样便于调试和向用户展示解析摘要。

## 16. 验收标准

### 16.1 Excel 解析

- 能过滤隐藏 Sheet。
- 能识别可见 Sheet。
- 能识别表头。
- 能识别合并单元格模块范围。
- 能识别模块内商品行数。
- 能读取单元格黄色标记。
- 能过滤隐藏行和空 SKU 行。

### 16.2 用户交互

- 能展示解析摘要。
- 能询问模板默认素材类型。
- 能展示 SKU 后缀覆盖结果。
- 能提示 full / patch 模式。
- 能在字段缺失、行数异常时给出明确提示。

### 16.3 JSON 生成

- 能生成符合 `schemaVersion = 1.0` 的 JSON。
- full 模式 values 顺序正确。
- patch 模式 patches 定位正确。
- `slotIndex` 计算正确。
- `expectedLayerCount` 计算正确。
- 图片字段包含 `sourceType`。
- SKU 后缀剥离正确。

## 17. 第一版开发范围

第一版必须支持：

- 可见 Sheet 过滤。
- 表头识别。
- 合并单元格模块识别。
- 模板规则库。
- `fieldOrder` 白名单输出。
- 默认素材类型交互确认。
- SKU 后缀素材类型覆盖。
- 黄色单元格 patch。
- full JSON。
- patch JSON。

第一版暂不要求：

- 条件格式颜色识别。
- PSD 图层读取。
- 自动检查 Photoshop 模板是否存在。
- 复杂导出命名模板。
- 视觉排序。

