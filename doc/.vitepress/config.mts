import { defineConfig } from 'vitepress';

export default defineConfig({
  base: '/dayloom/',
  title: 'Dayloom',
  description: '以天为单位推进的 AI 生活模拟与日记生成引擎',
  lang: 'zh-CN',
  cleanUrls: true,
  srcExclude: ['archive/**', 'redirects/**'],
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/GETTING_STARTED' },
      { text: '概念', link: '/concepts/WORLD_AND_DAY' },
      { text: '参考', link: '/reference/COMMANDS' },
      { text: '架构', link: '/architecture/DESIGN' },
      { text: 'GitHub', link: 'https://github.com/lithdoo/dayloom' },
    ],
    sidebar: [
      {
        text: '开始',
        items: [
          { text: '文档索引', link: '/README' },
          { text: '快速开始', link: '/guide/GETTING_STARTED' },
          { text: 'World 生命周期', link: '/guide/WORLD_LIFECYCLE' },
          { text: 'TUI 使用指南', link: '/guide/TUI' },
          { text: '故障排查', link: '/guide/TROUBLESHOOTING' },
        ],
      },
      {
        text: '核心概念',
        items: [
          { text: 'World 与 Day', link: '/concepts/WORLD_AND_DAY' },
          { text: 'Phase 与 Command', link: '/concepts/PHASE_AND_COMMAND' },
          { text: 'Session', link: '/concepts/SESSION' },
          { text: 'Archive 与 Revision', link: '/concepts/ARCHIVE_AND_REVISION' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: 'Commands', link: '/reference/COMMANDS' },
          { text: '配置', link: '/reference/CONFIGURATION' },
          { text: '环境变量', link: '/reference/ENVIRONMENT_VARIABLES' },
          { text: '存档格式', link: '/reference/ARCHIVE_FORMAT' },
        ],
      },
      {
        text: '包',
        items: [
          { text: '@dayloom/core', link: '/packages/CORE' },
          { text: '@dayloom/tui', link: '/packages/TUI' },
        ],
      },
      {
        text: '架构与测试',
        items: [
          { text: '系统架构', link: '/architecture/DESIGN' },
          { text: 'Runtime', link: '/architecture/RUNTIME' },
          { text: 'Session Manager', link: '/architecture/SESSION_MANAGER' },
          { text: '路线图', link: '/architecture/ROADMAP' },
          { text: '测试概览', link: '/testing/OVERVIEW' },
          { text: 'TUI E2E', link: '/testing/TUI_E2E' },
        ],
      },
      {
        text: '维护',
        items: [{ text: '文档规范', link: '/CONVENTIONS' }],
      },
    ],
    outline: { level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/lithdoo/dayloom' }],
    search: { provider: 'local' },
    footer: { message: 'Dayloom documentation', copyright: 'Copyright © 2026 lithdoo' },
  },
});
