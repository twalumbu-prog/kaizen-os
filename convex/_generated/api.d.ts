/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as departments from "../departments.js";
import type * as drive from "../drive.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as lib_oauthState from "../lib/oauthState.js";
import type * as lib_parsers_csv from "../lib/parsers/csv.js";
import type * as lib_parsers_excel from "../lib/parsers/excel.js";
import type * as lib_parsers_index from "../lib/parsers/index.js";
import type * as lib_parsers_payrollExtract from "../lib/parsers/payrollExtract.js";
import type * as lib_parsers_payrollRegister from "../lib/parsers/payrollRegister.js";
import type * as lib_parsers_pdf from "../lib/parsers/pdf.js";
import type * as lib_parsers_receipt from "../lib/parsers/receipt.js";
import type * as lib_periodSlice from "../lib/periodSlice.js";
import type * as lib_periods from "../lib/periods.js";
import type * as lib_qbExtract from "../lib/qbExtract.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as migrateMultiTenancy from "../migrateMultiTenancy.js";
import type * as migrateNHIMA from "../migrateNHIMA.js";
import type * as organizations from "../organizations.js";
import type * as profiles from "../profiles.js";
import type * as quickbooks from "../quickbooks.js";
import type * as reminders from "../reminders.js";
import type * as reportAssignments from "../reportAssignments.js";
import type * as reportTemplates from "../reportTemplates.js";
import type * as resetMay from "../resetMay.js";
import type * as revalidateAll from "../revalidateAll.js";
import type * as scores from "../scores.js";
import type * as seed from "../seed.js";
import type * as submissions from "../submissions.js";
import type * as validationRunner from "../validationRunner.js";
import type * as validators_bankReconciliation from "../validators/bankReconciliation.js";
import type * as validators_payroll from "../validators/payroll.js";
import type * as validators_registry from "../validators/registry.js";
import type * as validators_statutoryReceipts from "../validators/statutoryReceipts.js";
import type * as validators_types from "../validators/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  auth: typeof auth;
  crons: typeof crons;
  dashboard: typeof dashboard;
  departments: typeof departments;
  drive: typeof drive;
  http: typeof http;
  integrations: typeof integrations;
  "lib/oauthState": typeof lib_oauthState;
  "lib/parsers/csv": typeof lib_parsers_csv;
  "lib/parsers/excel": typeof lib_parsers_excel;
  "lib/parsers/index": typeof lib_parsers_index;
  "lib/parsers/payrollExtract": typeof lib_parsers_payrollExtract;
  "lib/parsers/payrollRegister": typeof lib_parsers_payrollRegister;
  "lib/parsers/pdf": typeof lib_parsers_pdf;
  "lib/parsers/receipt": typeof lib_parsers_receipt;
  "lib/periodSlice": typeof lib_periodSlice;
  "lib/periods": typeof lib_periods;
  "lib/qbExtract": typeof lib_qbExtract;
  "lib/roles": typeof lib_roles;
  "lib/scoring": typeof lib_scoring;
  migrateMultiTenancy: typeof migrateMultiTenancy;
  migrateNHIMA: typeof migrateNHIMA;
  organizations: typeof organizations;
  profiles: typeof profiles;
  quickbooks: typeof quickbooks;
  reminders: typeof reminders;
  reportAssignments: typeof reportAssignments;
  reportTemplates: typeof reportTemplates;
  resetMay: typeof resetMay;
  revalidateAll: typeof revalidateAll;
  scores: typeof scores;
  seed: typeof seed;
  submissions: typeof submissions;
  validationRunner: typeof validationRunner;
  "validators/bankReconciliation": typeof validators_bankReconciliation;
  "validators/payroll": typeof validators_payroll;
  "validators/registry": typeof validators_registry;
  "validators/statutoryReceipts": typeof validators_statutoryReceipts;
  "validators/types": typeof validators_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
