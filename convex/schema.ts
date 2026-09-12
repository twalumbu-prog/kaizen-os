import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const ROLES = v.union(
  v.literal("admin"),
  v.literal("manager"),
  v.literal("employee"),
);

export const CADENCE = v.union(
  v.literal("daily"),
  /** Every working day — Monday to Friday, no weekend periods. */
  v.literal("weekday"),
  v.literal("weekly"),
  v.literal("monthly"),
  /** A repeating run of active weeks separated by a break — see CYCLE_CONFIG. */
  v.literal("cycle"),
);

/**
 * Settings for the `cycle` cadence. Kept generic on purpose: a school reads
 * these as terms, another business as production runs or seasons.
 */
export const CYCLE_CONFIG = v.object({
  /** UTC ms, midnight — the first cycle's opening day. */
  anchor: v.number(),
  /** Active weeks per cycle. */
  lengthWeeks: v.number(),
  /** Break between cycles, in days. */
  gapDays: v.number(),
  /** 1-based week within the cycle at whose end the report falls due. */
  dueWeek: v.number(),
  /** Word used in period labels — "Term", "Sprint". Defaults to "Cycle". */
  label: v.optional(v.string()),
});

export const SUBMISSION_STATUS = v.union(
  v.literal("pending"),
  v.literal("submitted"),
  v.literal("late"),
  v.literal("missing"),
);

export const CHECKLIST_STATUS = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("warning"),
);

export const FILE_TYPE = v.union(
  v.literal("xlsx"),
  v.literal("pdf"),
  v.literal("csv"),
  /** Photos of paperwork — nothing is extracted from these, they are reviewed as images. */
  v.literal("jpg"),
  v.literal("png"),
  /** Word documents — like jpg/png, nothing is extracted, reviewed as a document. */
  v.literal("docx"),
);

export default defineSchema({
  ...authTables,
  // Extends the auth `users` table with orgName so the signup profile()
  // function can pass it through without being rejected by the schema.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.float64()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.float64()),
    isAnonymous: v.optional(v.boolean()),
    orgName: v.optional(v.string()),
    selectedOrgId: v.optional(v.id("organizations")),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  // Extends Convex Auth's `users` table with app-specific fields.
  profiles: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    role: ROLES,
    departmentId: v.optional(v.id("departments")),
    name: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

  organizations: defineTable({
    name: v.string(),
  }),

  departments: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_slug", ["slug"]),

  departmentMembers: defineTable({
    departmentId: v.id("departments"),
    userId: v.id("users"),
    roleInDept: v.string(),
  })
    .index("by_departmentId", ["departmentId"])
    .index("by_userId", ["userId"]),

  reportTemplates: defineTable({
    departmentId: v.id("departments"),
    name: v.string(),
    cadence: CADENCE,
    /** Required when `cadence` is "cycle"; ignored otherwise. */
    cycle: v.optional(CYCLE_CONFIG),
    /** Monthly only: day of the following month it falls due, instead of the 1st. */
    dueDayOfMonth: v.optional(v.number()),
    validatorKey: v.string(),
    weight: v.number(),
    /** Admin-entered opening balance for the first-ever period, when there's no prior period to roll forward from. */
    startingBalance: v.optional(v.number()),
    requiredFiles: v.array(
      v.object({
        label: v.string(),
        /** Formats accepted for this slot — at least one, enforced in reportTemplates.ts. */
        fileTypes: v.array(FILE_TYPE),
        required: v.boolean(),
      }),
    ),
    validationRules: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        enabled: v.boolean(),
        tolerance: v.optional(v.number()),
      }),
    ),
    quickbooksAccountId: v.optional(v.string()),
  }).index("by_departmentId", ["departmentId"]),

  reportAssignments: defineTable({
    templateId: v.id("reportTemplates"),
    userId: v.id("users"),
  })
    .index("by_templateId", ["templateId"])
    .index("by_userId", ["userId"]),

  submissions: defineTable({
    templateId: v.id("reportTemplates"),
    userId: v.id("users"),
    periodLabel: v.string(),
    /** Period window in ms, inclusive — see convex/lib/periods.ts. */
    periodStart: v.number(),
    periodEnd: v.number(),
    dueAt: v.number(),
    submittedAt: v.optional(v.number()),
    status: SUBMISSION_STATUS,
    submissionScore: v.optional(v.number()),
    finalScore: v.optional(v.number()),
    /** Validated bank closing balance, carried forward as next period's expected opening balance. */
    bankClosingBalance: v.optional(v.number()),
    /** True when submitted automatically by the system (cron/integration), not by a human. */
    isAutoSubmitted: v.optional(v.boolean()),
  })
    .index("by_templateId", ["templateId"])
    .index("by_userId", ["userId"])
    .index("by_templateId_periodLabel", ["templateId", "periodLabel"])
    .index("by_status", ["status"]),

  submissionFiles: defineTable({
    submissionId: v.id("submissions"),
    storageId: v.id("_storage"),
    label: v.string(),
    fileType: FILE_TYPE,
    fileName: v.string(),
  }).index("by_submissionId", ["submissionId"]),

  validationResults: defineTable({
    submissionId: v.id("submissions"),
    score: v.number(),
    summary: v.string(),
    computedAt: v.number(),
  }).index("by_submissionId", ["submissionId"]),

  validationChecklistItems: defineTable({
    validationResultId: v.id("validationResults"),
    title: v.string(),
    status: CHECKLIST_STATUS,
    explanation: v.string(),
    severity: v.string(),
    points: v.number(),
    maxPoints: v.number(),
  }).index("by_validationResultId", ["validationResultId"]),

  departmentScores: defineTable({
    departmentId: v.id("departments"),
    periodLabel: v.string(),
    healthScore: v.number(),
    submissionRate: v.number(),
    qualityScore: v.number(),
    lateCount: v.number(),
    missingCount: v.number(),
    computedAt: v.number(),
  })
    .index("by_departmentId", ["departmentId"])
    .index("by_departmentId_periodLabel", ["departmentId", "periodLabel"]),

  organizationScores: defineTable({
    orgId: v.id("organizations"),
    periodLabel: v.string(),
    healthScore: v.number(),
    computedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_periodLabel", ["orgId", "periodLabel"]),

  notifications: defineTable({
    userId: v.id("users"),
    type: v.string(),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_read", ["userId", "read"]),

  auditLogs: defineTable({
    userId: v.id("users"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  integrations: defineTable({
    orgId: v.id("organizations"),
    provider: v.union(
      v.literal("quickbooks"),
      v.literal("resend"),
      v.literal("google_drive"),
      v.literal("google_ai"),
      v.literal("meta")
    ),
    status: v.union(v.literal("active"), v.literal("disconnected")),
    config: v.optional(v.string()), // JSON string of integration-specific configuration
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_provider", ["orgId", "provider"]),

  // One-time, short-lived tokens binding an OAuth `state` param to the org/admin
  // that initiated the connect flow — prevents a caller from completing an OAuth
  // flow with a hand-crafted `state` to link their own third-party account to a
  // different org's integration.
  oauthStates: defineTable({
    token: v.string(),
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("google_drive")),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
});
