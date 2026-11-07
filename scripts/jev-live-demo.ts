// One-off live demo: ONE Jev call on a real issue (read-only inference).
import { jevIntake } from "./jev"
const out = await jevIntake({
  role: "opencode-github-bot: action wiring, plugin tools, prompt; reject upstream本体 bug and user business needs",
  freshTitle: "test: add a LICENSE badge to README",
  freshBody: "Add a CI license check badge to README. Background: repo lacks license visibility. Expect: badge renders.",
  candidates: [{ number: 8, title: "Feature: /oc setup-ci command", summary: "auto-generating CI workflow" }],
})
console.log(JSON.stringify(out, null, 1))
console.log("LIVE_OK")
