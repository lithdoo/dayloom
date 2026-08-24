import { defineConfig } from 'vitepress';

export default defineConfig({
  base: '/dayloom/',
  title: 'Dayloom',
  description: '以天为单位推进的 AI 叙事与生活模拟运行时',
  lang: 'zh-CN',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/GETTING_STARTED' },
      { text: '契约', link: '/contracts/CORE_RUNTIME_V1' },
      { text: '参考', link: '/reference/COMMANDS' },
      { text: 'GitHub', link: 'https://github.com/lithdoo/dayloom' },
    ],
    sidebar: [
      { text: '开始', items: [
        { text: '文档索引', link: '/README' },
        { text: '快速开始', link: '/guide/GETTING_STARTED' },
        { text: 'World 生命周期', link: '/guide/WORLD_LIFECYCLE' },
        { text: 'TUI', link: '/guide/TUI' },
        { text: '故障排查', link: '/guide/TROUBLESHOOTING' },
      ] },
      { text: '稳定契约', items: [
        { text: 'Core Runtime V1', link: '/contracts/CORE_RUNTIME_V1' },
        { text: 'World Profile V1', link: '/contracts/WORLD_PROFILE_V1' },
      ] },
      { text: '包与参考', items: [
        { text: '@dayloom/core', link: '/packages/CORE' },
        { text: '@dayloom/tui', link: '/packages/TUI' },
        { text: 'Commands', link: '/reference/COMMANDS' },
        { text: '配置', link: '/reference/CONFIGURATION' },
        { text: 'Archive', link: '/reference/ARCHIVE_FORMAT' },
        { text: '测试', link: '/testing/OVERVIEW' },
      ] },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/lithdoo/dayloom' }],
  },
});
