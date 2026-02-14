# GitHub Actions 测试文件

这个文件用于测试 GitHub Actions 自动化发布流程。

## 测试目的
1. 验证 GitHub Actions 工作流是否正确触发
2. 测试 semantic-release 版本管理
3. 验证 changelog 生成
4. 测试 GitHub Releases 创建

## 预期行为
- 提交到 main 分支后，GitHub Actions 工作流应该自动运行
- semantic-release 应该分析 commit 消息并确定版本号
- 应该生成或更新 CHANGELOG.md
- 应该创建 GitHub Release

## 提交消息格式
使用 conventional commits 格式：
- `test: trigger GitHub Actions release workflow`