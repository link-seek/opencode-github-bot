/** One-off calibration replay: Jev scores for historical issues (read-only, no labels). */
import { jevIntake } from "./jev"

const repo = process.env.GITHUB_REPOSITORY ?? ""
const token = process.env.GITHUB_TOKEN ?? ""
const nums = (process.env.REPLAY_ISSUES ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean)

async function gh(path: string): Promise<any> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  })
  if (!r.ok) throw new Error(`gh ${path}: ${r.status}`)
  return r.json()
}

const role = "opencode-github-bot: action wiring, plugin tools, prompt; reject upstream本体 bug and user business needs"
for (const n of nums) {
  try {
    const issue = await gh(`/repos/${repo}/issues/${n}`) as any
    const out = await jevIntake(
      {
        role,
        freshTitle: issue.title ?? "",
        freshBody: (issue.body ?? "").slice(0, 1500),
      },
      [],
    )
    const dup = out?.duplicate == null ? "n/a" : out.duplicate.toFixed(2)
    console.log(`#${n} | fit=${out?.repo_fit.toFixed(2)} clear=${out?.is_clear.toFixed(2)} type=${out?.type}(${out?.typeConfidence.toFixed(2)}) size=${out?.size.toFixed(2)} pri=${out?.priority.toFixed(2)} dup=${dup} conf=${out ? [out.confidences.is_clear, out.confidences.size, out.confidences.priority].map((c) => c.toFixed(2)).join("/") : "-"} | ${issue.title?.slice(0, 50)}`)
  } catch (e: any) {
    console.log(`#${n} ERROR ${e.message}`)
  }
}
