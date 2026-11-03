// Zeron-style sidebar: projects (spaces) as foldable groups, each tab a session row
// with "project @ host", its age, the title, and the git branch.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, focused, exec, run, theme, shared, setAgentOrder, openOverlay, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

function icon(p, size, color) {
  if (!p?.icon) return svg("mods/workspace-chrome/terminal.svg").size(size).flex_none().text_color(color);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class ZeronSessions extends View {
  init(_props, cx) {
    this.folded = new Set();
    this.host = "";
    cx.timer.every(30000, (cx) => cx.notify());
    cx.spawn(async (cx) => {
      try {
        this.host = (await exec("hostname", [])).stdout.trim();
      } catch {}
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const sp = spaces();
    const ps = panes();
    const ag = agents();
    const now = Date.now();
    const f = focused();
    const colors = shared("space.colors") ?? {};
    const tone = { working: t.working, blocked: t.blocked, done: t.done };
    const order = [];

    const session = (w, tab) => {
      const l = lead(tab, ps);
      const a = ag.find((x) => x.tab === tab.id);
      if (a) order.push(a.address);
      const on = f?.tab === tab.id;
      const color = tone[tab.status] ?? (on ? t.foreground : t.muted);
      const age = tab.changed_at ? duration(now - tab.changed_at) : "";
      const host = w.machine ?? this.host;
      const click = () => (l ? run("pane.focus", { pane: l.pane }) : run("tab.select", { id: tab.id }));
      return v_flex()
        .id(`zs-${tab.id}`)
        .flex_none()
        .px(10)
        .py(7)
        .gap(3)
        .rounded(9)
        .border_1()
        .border_color(on ? t.border : "#00000000")
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .cursor_pointer()
        .on_click(click)
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .text_size(11)
            .text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(host ? `${w.name} @ ${host}` : w.name))
            .when(Boolean(age), (el) => el.child(div().flex_none().child(age))),
        )
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(icon(l?.program, 15, color))
            .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(on ? t.foreground : t.muted).child(title(tab, l))),
        )
        .when(Boolean(l?.branch), (el) =>
          el.child(
            h_flex()
              .gap(6)
              .items_center()
              .text_size(11)
              .text_color(t.dim)
              .child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none())
              .child(div().flex_1().min_w(0).truncate().child(l.branch)),
          ),
        );
    };

    const compact = narrow();
    if (compact) {
      const rows = sp.flatMap((w) =>
        w.tabs.map((tab) => {
          const l = lead(tab, ps);
          const a = ag.find((x) => x.tab === tab.id);
          if (a) order.push(a.address);
          const on = f?.tab === tab.id;
          return h_flex()
            .id(`zs-${tab.id}`)
            .h(30)
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(8)
            .when(on, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .cursor_pointer()
            .on_click(() => (l ? run("pane.focus", { pane: l.pane }) : run("tab.select", { id: tab.id })))
            .child(icon(l?.program, 15, tone[tab.status] ?? t.muted));
        }),
      );
      setAgentOrder(order);
      return v_flex().size_full().min_h(0).bg(t.chrome).p(4).gap(2).children(rows);
    }

    const rows = sp.flatMap((w) => {
      const open = !this.folded.has(w.id);
      const tile = t[colors[w.id]] ?? t.accent;
      const header = h_flex()
        .id(`zh-${w.id}`)
        .flex_none()
        .h(36)
        .mt(6)
        .px(10)
        .gap(9)
        .items_center()
        .rounded(8)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          open ? this.folded.add(w.id) : this.folded.delete(w.id);
          cx.notify();
        })
        .on_mouse_down("right", () =>
          openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } }),
        )
        .child(
          h_flex()
            .size(18)
            .flex_none()
            .rounded(5)
            .bg(tile)
            .items_center()
            .justify_center()
            .text_size(10.5)
            .font_bold()
            .text_color("#ffffff")
            .child([...w.name][0]?.toUpperCase() ?? "?"),
        )
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.foreground).child(w.name))
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(13).flex_none().text_color(t.dim));
      return [header, ...(open ? w.tabs.map((tab) => session(w, tab)) : [])];
    });
    setAgentOrder(order);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(
        h_flex()
          .h(34)
          .flex_none()
          .pl(16)
          .pr(10)
          .items_center()
          .justify_between()
          .text_size(11.5)
          .text_color(t.dim)
          .child("Projects")
          .child(
            div()
              .id("zs-new")
              .size(26)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("space.new"))
              .child(svg("mods/workspace-chrome/plus.svg").size(14)),
          ),
      )
      .child(v_flex().id("zs-list").flex_1().min_h(0).px(8).pb(12).gap(2).overflow_y_scrollbar().mode("always").children(rows));
  }
}
