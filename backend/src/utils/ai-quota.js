const pool = require('../config/database');
const { sendMail } = require('../services/email');

// Enforces two independent instance-wide quotas against the current calendar
// month's ai_usage rows (both NULL = unlimited):
//   - instance_settings.monthly_ai_call_limit  — call count
//   - instance_settings.monthly_ai_budget_usd  — summed ai_usage.cost_usd
//
// Checked before chat, preview, authoring-assist and voice calls; evaluation
// calls are deliberately exempt so a student who has finished a session can
// always be graded. Calls on unpriced models log cost_usd = NULL and
// therefore don't count toward the budget — only the call limit stops them.
//
// Fails open: a telemetry/DB hiccup here must never block a live session.
//
// Threshold alerts: crossing 80% or 100% of either quota emails the
// administrator (instance_settings.alert_email, then ALERT_EMAIL, then
// SMTP_USER) at most once per month, quota type, and threshold — deduped
// via the quota_alerts table.
async function checkAiQuota() {
  try {
    const { rows } = await pool.query(
      `SELECT s.monthly_ai_call_limit AS call_limit,
              s.monthly_ai_budget_usd AS budget_usd,
              s.alert_email,
              (SELECT COUNT(*) FROM ai_usage u
               WHERE u.created_at >= date_trunc('month', CURRENT_TIMESTAMP)) AS calls_this_month,
              (SELECT COALESCE(SUM(u.cost_usd), 0) FROM ai_usage u
               WHERE u.created_at >= date_trunc('month', CURRENT_TIMESTAMP)) AS spend_this_month
       FROM instance_settings s`
    );
    if (rows.length === 0) return { allowed: true };
    const { call_limit, budget_usd, alert_email, calls_this_month, spend_this_month } = rows[0];

    const calls = Number(calls_this_month);
    const spend = Number(spend_this_month);
    const callLimit = call_limit == null ? null : Number(call_limit);
    const budget = budget_usd == null ? null : Number(budget_usd);

    // Fire-and-forget: threshold alert emails (never blocks the request).
    maybeSendThresholdAlerts({ alert_email, calls, callLimit, spend, budget })
      .catch((err) => console.error('[ai-quota] alert check failed:', err.message));

    const overCalls = callLimit != null && calls >= callLimit;
    const overBudget = budget != null && spend >= budget;

    return {
      allowed: !overCalls && !overBudget,
      reason: overCalls ? 'calls' : overBudget ? 'budget' : undefined,
      used: calls,
      limit: callLimit,
      spendUsd: spend,
      budgetUsd: budget,
    };
  } catch (err) {
    console.error('[ai-quota] check failed, allowing call:', err.message);
    return { allowed: true };
  }
}

// Insert-if-new into quota_alerts for each crossed threshold; email only the
// highest newly-crossed threshold per quota type (a fast crossing of both 80
// and 100 sends one email, not two).
async function maybeSendThresholdAlerts({ alert_email, calls, callLimit, spend, budget }) {
  const checks = [];
  if (callLimit != null && callLimit > 0) {
    checks.push({ type: 'calls', pct: (calls / callLimit) * 100, used: calls.toLocaleString(), limit: callLimit.toLocaleString(), unit: 'calls' });
  }
  if (budget != null && budget > 0) {
    checks.push({ type: 'budget', pct: (spend / budget) * 100, used: `$${spend.toFixed(2)}`, limit: `$${budget.toFixed(2)}`, unit: 'spend' });
  }

  for (const check of checks) {
    let highestNew = null;
    for (const threshold of [100, 80]) {
      if (check.pct < threshold) continue;
      const { rowCount } = await pool.query(
        `INSERT INTO quota_alerts (month, quota_type, threshold)
         VALUES (date_trunc('month', CURRENT_TIMESTAMP)::date, $1, $2)
         ON CONFLICT (month, quota_type, threshold) DO NOTHING`,
        [check.type, threshold]
      );
      if (rowCount === 1 && highestNew == null) highestNew = threshold;
    }
    if (highestNew == null) continue;

    const to = alert_email || process.env.ALERT_EMAIL || process.env.SMTP_USER;
    if (!to) continue;
    const label = check.type === 'calls' ? 'AI call limit' : 'AI budget';
    const subject = `[LTISim] ${highestNew}% of monthly ${label} reached`;
    const text =
      `This LTISim instance has reached ${Math.floor(check.pct)}% of its monthly ${label}.\n\n` +
      `Current month ${check.unit}: ${check.used} of ${check.limit}.\n\n` +
      (highestNew >= 100
        ? 'New chat and preview AI calls are now blocked. Evaluation of already-completed sessions continues so no student is left ungraded.\n\n'
        : 'AI calls continue until 100%.\n\n') +
      'An instance administrator can adjust the limits in the instance settings.';
    await sendMail({ to, subject, text });
    console.log(`[ai-quota] sent ${highestNew}% ${check.type} alert`);
  }
}

module.exports = { checkAiQuota };
