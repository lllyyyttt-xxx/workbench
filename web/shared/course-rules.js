/* 课表规则：校验、补时间、查冲突
 *
 * 这套规则原来只写在时间管理模块的编辑面板里。现在 AI 也要改课表，
 * 两条路必须用同一份规则，否则面板能存、AI 能存出脏数据，
 * 过一阵子课表就对不上了。所以抽出来放共享层，两边都调这里。
 *
 * 对外三个函数：
 *   validate(tt, c)         检查一条课，返回 '' 表示没问题，否则返回一句人话
 *   fillTimes(tt, c)        按节次把起止时间补上（已经填了的不动）
 *   conflict(tt, c, skip)   查这条课跟已有的哪条撞了，没撞返回 null
 */
window.WorkbenchCourseRules = (function () {
  'use strict';

  function minutesOf(t) {
    var p = String(t || '').split(':');
    var h = Number(p[0]), m = Number(p[1]);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }

  function totalWeeks(tt) {
    var n = Number(tt && tt.term && tt.term.totalWeeks);
    return n > 0 ? n : 16;
  }

  /* 把 all / odd / even / [..] 摊成一份具体的周次表 */
  function weekSet(tt, w) {
    var out = {};
    var total = totalWeeks(tt);
    var i;
    if (w === 'odd') {
      for (i = 1; i <= total; i += 2) out[i] = true;
    } else if (w === 'even') {
      for (i = 2; i <= total; i += 2) out[i] = true;
    } else if (Array.isArray(w)) {
      w.forEach(function (n) {
        var v = Number(n);
        if (v >= 1 && v <= total) out[v] = true;
      });
    } else {
      for (i = 1; i <= total; i++) out[i] = true;
    }
    return out;
  }

  function weeksOverlap(tt, a, b) {
    var A = weekSet(tt, a), B = weekSet(tt, b);
    var keys = Object.keys(A);
    for (var i = 0; i < keys.length; i++) {
      if (B[keys[i]]) return true;
    }
    return false;
  }

  function fillTimes(tt, c) {
    var slots = (tt && tt.slots) || {};
    if (!c.start && slots[c.from] && slots[c.from].start) c.start = slots[c.from].start;
    if (!c.end && slots[c.to] && slots[c.to].end) c.end = slots[c.to].end;
    return c;
  }

  function validate(tt, c) {
    if (!c || typeof c !== 'object') return '课程数据不是一个对象。';

    var name = String(c.name || '').trim();
    if (!name) return '课程名不能空着。';

    var day = Number(c.day);
    if (!(day >= 1 && day <= 7)) return '星期几要写 1 到 7，1 是周一。';

    var from = Number(c.from), to = Number(c.to);
    if (!(from >= 1) || !(to >= 1)) return '节次要写正整数。';
    if (to < from) return '开始那节不能比结束那节晚（第 ' + from + ' 节到第 ' + to + ' 节）。';

    var slots = (tt && tt.slots) || {};
    if (!slots[from]) return '第 ' + from + ' 节不存在，先到课表设置里把作息节次加上。';
    if (!slots[to]) return '第 ' + to + ' 节不存在，先到课表设置里把作息节次加上。';

    var start = c.start || (slots[from] && slots[from].start);
    var end = c.end || (slots[to] && slots[to].end);
    if (!start || !end) return '起止时间没填，而且第 ' + from + '/' + to + ' 节的作息时间也没设。';
    if (minutesOf(start) === null || minutesOf(end) === null) return '时间要写成 08:20 这样。';
    if (minutesOf(end) <= minutesOf(start)) return '结束时间要晚于开始时间。';

    var w = c.weeks;
    if (!(w === 'all' || w === 'odd' || w === 'even' || Array.isArray(w))) {
      return '周次只能是 all、odd、even，或者 [1,3,5] 这样的数组。';
    }
    if (Array.isArray(w) && !w.length) return '指定周次的列表是空的。';

    return '';
  }

  /* 节次区间有没有交叠 */
  function slotOverlap(a, b) {
    return Number(a.from) <= Number(b.to) && Number(b.from) <= Number(a.to);
  }

  function conflict(tt, c, skipIndex) {
    var list = (tt && tt.courses) || [];
    for (var i = 0; i < list.length; i++) {
      if (i === skipIndex) continue;
      var o = list[i];
      if (Number(o.day) !== Number(c.day)) continue;
      if (!slotOverlap(o, c)) continue;
      if (!weeksOverlap(tt, o.weeks, c.weeks)) continue;
      return { index: i, course: o };
    }
    return null;
  }

  function weeksText(tt, w) {
    if (w === 'odd') return '单周';
    if (w === 'even') return '双周';
    if (Array.isArray(w)) return '第 ' + w.join('、') + ' 周';
    return '每周';
  }

  function dayText(day) {
    var n = ['', '一', '二', '三', '四', '五', '六', '日'][Number(day)];
    return n ? '周' + n : '周' + day;
  }

  /* 一条课说成人话：「周三第1-4节 Web前端开发技术（3-809）」 */
  function human(tt, c) {
    var seg = '第' + c.from + (Number(c.to) !== Number(c.from) ? '-' + c.to : '') + '节';
    var w = c.weeks === 'all' ? '' : '（' + weeksText(tt, c.weeks) + '）';
    return dayText(c.day) + seg + ' ' + c.name + w + (c.room ? '（' + c.room + '）' : '');
  }

  return {
    minutesOf: minutesOf,
    weekSet: weekSet,
    weeksOverlap: weeksOverlap,
    fillTimes: fillTimes,
    validate: validate,
    conflict: conflict,
    weeksText: weeksText,
    dayText: dayText,
    human: human,
    totalWeeks: totalWeeks
  };
})();
