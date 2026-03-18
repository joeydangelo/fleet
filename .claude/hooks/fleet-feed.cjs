const fs = require("fs");
const input = JSON.parse(fs.readFileSync(0, "utf-8"));
const tn = input.tool_name || "";
const ti = input.tool_input || {};
let task = process.env.FLEET_TASK || "orchestrator";
if (process.env.FLEET_ROLE === "reviewer") task += ":reviewer";
const ts = new Date().toTimeString().slice(0, 8);
const mainRoot = process.env.FLEET_MAIN_ROOT || ".";
const feed = mainRoot + "/.fleet/run/feed.ndjson";

let ev;
if (tn === "Bash") {
  const cmd = ti.command || "";
  if (cmd.startsWith("fleet ")) process.exit(0);
  if (/\bgit commit\b/.test(cmd)) {
    const m = cmd.match(/-m\s+"([^"]*)"/) || cmd.match(/-m\s+'([^']*)'/);
    const msg = m ? m[1].slice(0, 50) : "";
    ev = { ts, task, event: "git.commit", msg };
  } else {
    ev = { ts, task, event: "tool.Bash", cmd: cmd.slice(0, 120) };
  }
} else {
  switch (tn) {
    case "Read":
      ev = { ts, task, event: "tool.Read", file: ti.file_path || "" };
      break;
    case "Glob":
    case "Grep": {
      const o = input.tool_output || "";
      const h = o ? o.split("\n").filter(Boolean).length : 0;
      ev = { ts, task, event: "tool." + tn, pattern: ti.pattern || "", hits: h };
      break;
    }
    case "Edit": {
      const ns = ti.new_string || "";
      const l = ns.split("\n").length;
      ev = { ts, task, event: "tool.Edit", file: ti.file_path || "", lines: l };
      break;
    }
    case "Write":
      ev = { ts, task, event: "tool.Write", file: ti.file_path || "" };
      break;
    case "Agent": {
      ev = { ts, task, event: "tool.Agent", description: ti.description || "" };
      if (ti.model) ev.model = ti.model;
      break;
    }
    case "Skill":
      ev = { ts, task, event: "tool.Skill", skill: ti.skill || "" };
      break;
    default:
      ev = { ts, task, event: "tool." + tn };
      break;
  }
}
fs.appendFileSync(feed, JSON.stringify(ev) + "\n");
