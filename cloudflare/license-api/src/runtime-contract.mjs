export const CONTRACTS = Object.freeze({
  account_center: {version: 1, routes: ["GET /v1/account/overview", "GET /v1/scorpio_v1_admin/users", "GET /v1/scorpio_v1_admin/authorizations", "GET /v1/scorpio_v1_admin/account-requests", "POST /v1/scorpio_v1_admin/users/record-action"]},
  admin_operations: {version: 1, routes: ["GET /v1/scorpio_v1_admin/operations"]},
  feedback_center: {version: 1, routes: ["GET /v1/account/feedback", "GET /v1/account/feedback/detail", "GET /v1/account/feedback/attachment", "GET /v1/scorpio_v1_admin/feedback/detail", "GET /v1/scorpio_v1_admin/feedback/attachment"]},
  auth_security: {version: 1, routes: ["GET /v1/auth/security"]},
  mobile_portfolio: {version: 2, routes: ["POST /v2/mobile/portfolio/query", "PUT /v2/mobile/portfolio/snapshot", "POST /v2/mobile/portfolio/scenario", "POST /v2/mobile/portfolio/history"]},
  signal_storage: {version: 1, routes: ["GET /v1/scorpio_v1_admin/storage-budget", "POST /v1/scorpio_v1_admin/storage-budget/signal-archive"]},
});

export function runtimeHealth(routes, env) {
  return {ok: true, service: "scorpio-license-api",
    contracts: Object.fromEntries(Object.entries(CONTRACTS).map(([name, contract]) => [name, contract.routes.every((key) => routes.has(key)) ? contract.version : 0])),
    storage: {feedback_screenshots: Boolean(env.FEEDBACK_BUCKET?.get && env.FEEDBACK_BUCKET?.put)},
  };
}
