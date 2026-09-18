# Contributing

欢迎提交问题、建议和改进。

## 提交问题前

1. 确认使用的是最新 Release；
2. 在 `chrome://extensions/` 中重新加载扩展并刷新课程页面；
3. 搜索已有 Issue，避免重复报告；
4. 删除截图或日志中的姓名、学号、Cookie 和带鉴权参数的视频地址。

## 本地开发

本项目没有构建步骤或第三方运行时依赖：

1. 克隆仓库；
2. 打开 `chrome://extensions/`；
3. 开启开发者模式；
4. 点击“加载已解压的扩展程序”并选择仓库目录；
5. 修改后点击扩展卡片上的“重新加载”，再刷新课堂实录页面。

提交前请运行：

```bash
node --check content.js
node --check background.js
jq empty manifest.json
```

## Pull Request

- 每个 PR 聚焦一个问题；
- 描述用户可见的变化和验证方式；
- UI 修改尽量附截图；
- 不要提交真实课程数据、视频地址或任何鉴权信息。
