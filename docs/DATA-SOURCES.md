# 第三方数据来源与许可

本仓库包含两部分外部数据，分别说明来源与许可。

---

## 1. 四六级词库

`desktop/modules/english/index.html` 与 `web/modules/english/index.html` 中的
`CET4_WORDS`、`CET6_WORDS` 两个数组，词条（单词、音标、词性、中文释义、词频）
来自 **ECDICT**，经脚本筛选 `tag` 含 `cet4` / `cet6` 的条目并做格式化。

- 项目地址：<https://github.com/skywind3000/ECDICT>
- 许可：MIT License
- 版本：master 分支（2026-11 抓取），原始数据表 `ecdict.csv`

筛选结果：四级 3844 词、六级专属 1952 词，合计 5796 词。

### ECDICT LICENSE

```
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. 阅读文章

`SENTS`、`PAPERS`、`EXAM`、`SENT_INDEX` 四个数组中的短文与句子，均为本项目作者
原创撰写，随本仓库以 MIT License 发布，可自由使用。

---

## 3. 关于四六级真题

**本仓库不包含任何四六级考试真题原文。** 真题内容版权归原权利人所有，不随本仓库分发。

如果你想在本地使用真题，请自行准备文本，并按 README「词库与原文数据」一节说明
替换 `SENTS` / `PAPERS` 数组。作者本地的完整版本同样不对外分发。
