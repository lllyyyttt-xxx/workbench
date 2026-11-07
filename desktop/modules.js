/* 模块清单
 *
 * 想加新模块，就在这里加一条，卡片会自动出现，不用改首页的其他地方。
 *   id      模块标识，同时是存储命名空间，不能重复
 *   name    卡片上显示的名字
 *   desc    一句话说明
 *   href    入口地址（相对本页），留空表示还没做好
 *   icon    卡片上的符号，随便填一个字符或短词
 *   color   卡片主色
 *   tags    小标签
 */
window.WORKBENCH_MODULES = [
  {
    id: 'english',
    name: '英语工作台',
    desc: '四六级单词、原文出处、背词复习、读文章',
    href: 'modules/english/index.html',
    icon: '英',
    color: '#00897b',
    tags: ['背单词', '词库', '单词本']
  },
  {
    id: 'life',
    name: '生活',
    desc: '记账、待办、倒计时',
    href: 'modules/life/index.html',
    icon: '生',
    color: '#e57373',
    tags: ['记账', '待办', '倒计时']
  },
  {
    id: 'challenge',
    name: '随机挑战',
    desc: '抽一档挑战，抽到就做，完成或放弃都算数',
    href: 'modules/challenge/index.html',
    icon: '挑',
    color: '#6b81a8',
    tags: ['抽签', '打卡', '连续记录']
  },
  {
    id: 'notes',
    name: '随手记',
    desc: '灵感收件箱、情绪精力，记一笔就走',
    href: 'modules/notes/index.html',
    icon: '记',
    color: '#5c8a5d',
    tags: ['灵感', '情绪']
  },
  {
    id: 'time',
    name: '时间管理',
    desc: '课表、日常规划、时间记录，看清楚时间都去哪了',
    href: 'modules/time/index.html',
    icon: '时',
    color: '#4a6fa5',
    tags: ['课表', '规划', '时间']
  }
];
