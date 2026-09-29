/**
 * Local grader: runs every script in conversations/ and adversarial/ through the
 * engine three times and compares against each script's `expected` block.
 *   bun scripts/check-scripts.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runConversation } from "../src/lib/agent/engine";

let pass = 0;
let fail = 0;

for (const folder of ["conversations", "adversarial"]) {
  for (const file of readdirSync(folder).filter((f) => f.endsWith(".json")).sort()) {
    const script = JSON.parse(readFileSync(join(folder, file), "utf-8"));
    const runs = [0, 1, 2].map(() => runConversation(script.id, script.today, script.turns));
    const r = runs[0];
    const names = new Set(r.tool_calls.map((c) => c.name));
    const fingerprints = new Set(
      runs.map((x) => `${x.terminal_state}|${x.escalation_reason}|${[...new Set(x.tool_calls.map((c) => c.name))].sort().join(",")}`),
    );
    const e = script.expected;
    const problems: string[] = [];
    if (r.terminal_state !== e.terminal_state) problems.push(`terminal ${r.terminal_state} != ${e.terminal_state}`);
    if ((r.escalation_reason ?? null) !== (e.escalation_reason ?? null)) {
      problems.push(`reason ${r.escalation_reason} != ${e.escalation_reason}`);
    }
    for (const n of e.must_call ?? []) if (!names.has(n)) problems.push(`missing ${n}`);
    for (const n of e.must_not_call ?? []) if (names.has(n)) problems.push(`forbidden ${n}`);
    if (fingerprints.size !== 1) problems.push("non-deterministic across 3 runs");

    if (problems.length) {
      fail += 1;
      console.log(`FAIL ${script.id}: ${problems.join("; ")}`);
      console.log(`     tools=[${[...names].join(", ")}] reply="${r.reply}"`);
    } else {
      pass += 1;
      console.log(`pass ${script.id}  ${r.terminal_state}/${r.escalation_reason} [${[...names].join(", ")}]`);
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
