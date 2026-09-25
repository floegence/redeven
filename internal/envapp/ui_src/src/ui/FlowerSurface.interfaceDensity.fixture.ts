// Mixed scripts intentionally exercise Latin and CJK font fallback and wrapping.
export const INTERFACE_DENSITY_MARKDOWN = `**Concrete usage example:** on any web page, select some text, choose “将选中文字转为图片” from the menu, and adjust the settings in the editor.

## Prerequisites: what's already here

**Already available:** Node.js, npm and Python are installed. The Go project lives in \`cline-test\`; run \`go run .\` to start the service on port 8080.

**Missing / would need network:** some dependencies are not cached. The first build needs network access before it can complete.

## 从哪里开始阅读

先查看项目入口与目录结构，再阅读核心业务逻辑。长路径、命令和状态信息需要保持完整语义，列表标题应当得到足够的显示空间。

- 查看 \`main.go\`，理解启动流程与路由。
- 阅读模型定义，确认存储结构和数据关系。
- 运行针对性测试，再检查真实界面的交互行为。

## My recommendation

Focus on the working application first. Keep the interface compact, preserve readable body text, and verify the result with realistic conversations.`;
