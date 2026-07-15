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
  v.literal("weekly"),
  v.literal("monthly"),
);

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
);

export default defineSchema({
  ...authTables,

  // Extends Convex Auth's `users` table with app-specific fields.
  profiles: defineTable({
    userId: v.id("users"),
    role: ROLES,
    departmentId: v.optional(v.id("departments")),
    name: v.string(),
  }).index("by_userId", ["userId"]),

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
    validatorKey: v.string(),
    weight: v.number(),
    requiredFiles: v.array(
      v.object({
        label: v.string(),
        fileType: FILE_TYPE,
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
    dueAt: v.number(),
    submittedAt: v.optional(v.number()),
    status: SUBMISSION_STATUS,
    submissionScore: v.optional(v.number()),
    finalScore: v.optional(v.number()),
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
});
