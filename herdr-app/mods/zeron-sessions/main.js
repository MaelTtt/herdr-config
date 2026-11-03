// Zeron-style sidebar: projects (spaces) as foldable groups, each tab a session row
// with "project @ host", its age, the title, and the git branch.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, focused, exec, run, theme, shared, setAgentOrder, openOverlay, layout, appHome } from "herdr";

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

function resetIn(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const BAR = 104;
const usageColor = (t, pct) => (pct >= 90 ? "#f87171" : pct >= 70 ? t.blocked : t.accent);
const USAGE_HINT = {
  "no-key": "Add a Factory API key to show usage",
  "token-expired": "Login expired, waiting for refresh",
  "no-token": "Not signed in",
  "no-plan": "No active plan",
};

export default class ZeronSessions extends View {
  init(_props, cx) {
    this.folded = new Set();
    this.host = "";
    this.usage = null;
    cx.timer.every(30000, (cx) => cx.notify());
    cx.spawn(async (cx) => {
      try {
        this.host = (await exec("hostname", [])).stdout.trim();
      } catch {}
      cx.notify();
    });
    // The script caches and rate-limits itself, so asking every minute only reads a file.
    this.pull(cx);
    cx.timer.every(60000, (cx) => this.pull(cx));
  }

  pull(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${appHome()}/bin/usage.py`]);
        this.usage = JSON.parse(r.stdout);
      } catch {}
      cx.notify();
    });
  }

  // One provider: its name with when the 5h window resets, then a bar per window.
  usageCard(t, name, u) {
    const windows = u?.ok ? [["5h", u.five_hour], ["7d", u.weekly], ["30d", u.monthly]].filter(([, w]) => w) : [];
    const reset = u?.five_hour?.resets_at ? resetIn(u.five_hour.resets_at) : "";
    return v_flex()
      .gap(5)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .text_size(11)
          .child(div().text_color(t.muted).font_medium().child(name))
          .child(div().text_color(t.dim).child(u?.ok ? (u.stale ? "stale" : reset ? `resets ${reset}` : "") : "")),
      )
      .when(!u?.ok, (el) => el.child(div().text_size(11).text_color(t.dim).child(u ? (USAGE_HINT[u.error] ?? "Unavailable") : "Loading…")))
      .children(
        windows.map(([label, w]) =>
          h_flex()
            .gap(8)
            .items_center()
            .text_size(11)
            .child(div().w(22).flex_none().text_color(t.dim).child(label))
            .child(
              div().w(BAR).h(5).flex_none().rounded(3).bg(t.border).child(
                div().w(Math.max(3, Math.round((BAR * Math.min(w.pct, 100)) / 100))).h(5).rounded(3).bg(usageColor(t, w.pct)),
              ),
            )
            .child(div().flex_1().text_right().text_color(w.pct >= 70 ? usageColor(t, w.pct) : t.muted).child(`${Math.round(w.pct)}%`)),
        ),
      );
  }

  usageBlock(t) {
    return v_flex()
      .flex_none()
      .gap(12)
      .px(16)
      .py(12)
      .border_t(1)
      .border_color(t.border)
      .child(this.usageCard(t, "Claude", this.usage?.claude))
      .child(this.usageCard(t, "Droid", this.usage?.factory));
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

    // Spaces with the same name on the same machine are one project: each "new session"
    // made a space of its own, and they would otherwise repeat the same header.
    const groups = [];
    for (const s of sp) {
      const key = `${s.machine ?? ""}\u0000${s.name}`;
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, spaces: [] }));
      g.spaces.push(s);
    }

    const rows = groups.flatMap((g) => {
      const w = g.spaces.find((s) => s.active) ?? g.spaces[0];
      const open = !this.folded.has(g.key);
      const hot = this.hovered === g.key;
      const tile = t[colors[g.spaces[0].id]] ?? t.accent;
      const header = h_flex()
        .id(`zh-${g.spaces[0].id}`)
        .flex_none()
        .h(36)
        .mt(6)
        .px(10)
        .gap(9)
        .items_center()
        .rounded(8)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = g.key;
          else if (this.hovered === g.key) this.hovered = null;
          cx.notify();
        })
        .on_click((_e, cx) => {
          open ? this.folded.add(g.key) : this.folded.delete(g.key);
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
        .when(hot, (el) =>
          el.child(
            div()
              .id(`zn-${g.spaces[0].id}`)
              .size(22)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .text_color(t.dim)
              .hover((s) => s.bg(t.selected).text_color(t.foreground))
              .tooltip("New session in this project")
              .on_click((_e, cx) => {
                cx.stop_propagation();
                run("space.select", { id: w.id });
                openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
              })
              .child(svg("mods/workspace-chrome/plus.svg").size(13)),
          ),
        )
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(13).flex_none().text_color(t.dim));
      return [header, ...(open ? g.spaces.flatMap((s) => s.tabs.map((tab) => session(s, tab))) : [])];
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
      .child(v_flex().id("zs-list").flex_1().min_h(0).px(8).pb(12).gap(2).overflow_y_scrollbar().mode("always").children(rows))
      .child(this.usageBlock(t));
  }
}
