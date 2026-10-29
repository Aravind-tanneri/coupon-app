import { prisma } from "../../lib/prisma.js";
import { parseDateIST, formatDateIST, addDaysIST } from "../../lib/dates-ist.js";
import { BusinessRuleError, ConflictError } from "../../lib/errors.js";
import { auditService } from "../audit/audit.service.js";
import { CreatePolicyInput } from "./reimbursement.schemas.js";

export class PolicyService {
  /**
   * Retrieves all historical and active policies for a mess, sorted by effectiveFrom descending.
   */
  async listPolicies(messId: string) {
    return prisma.reimbursementPolicy.findMany({
      where: { messId },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  /**
   * Creates a new immutable reimbursement policy row.
   * Closes the previous active policy's effectiveUntil to the day before effectiveFrom.
   */
  async createPolicy(input: CreatePolicyInput, actorId: string, ip?: string) {
    const effectiveFromDate = parseDateIST(input.effectiveFrom);

    return prisma.$transaction(async (tx) => {
      // 1. Find the currently active or overlapping policy for this mess
      const existingPolicies = await tx.reimbursementPolicy.findMany({
        where: { messId: input.messId },
        orderBy: { effectiveFrom: "desc" },
      });

      // Check if an existing policy has an identical or later effectiveFrom
      const futureOrSame = existingPolicies.find(
        (p) =>
          parseDateIST(formatDateIST(p.effectiveFrom)).getTime() >= effectiveFromDate.getTime(),
      );

      if (futureOrSame) {
        throw new ConflictError(
          `Cannot create policy starting on ${input.effectiveFrom}; a policy already starts on ${formatDateIST(futureOrSame.effectiveFrom)}.`,
          "POLICY_OVERLAP",
        );
      }

      // Close the latest active policy (where effectiveUntil is null or >= effectiveFrom)
      const previousActive = existingPolicies.find(
        (p) =>
          !p.effectiveUntil ||
          parseDateIST(formatDateIST(p.effectiveUntil)).getTime() >= effectiveFromDate.getTime(),
      );

      if (previousActive) {
        const closedDate = addDaysIST(effectiveFromDate, -1);
        if (
          closedDate.getTime() < parseDateIST(formatDateIST(previousActive.effectiveFrom)).getTime()
        ) {
          throw new BusinessRuleError(
            "INVALID_POLICY_DATE",
            "Effective date cannot close previous policy before its start date.",
          );
        }

        await tx.reimbursementPolicy.update({
          where: { id: previousActive.id },
          data: {
            effectiveUntil: closedDate,
          },
        });
      }

      // 2. Create the new immutable policy
      const newPolicy = await tx.reimbursementPolicy.create({
        data: {
          messId: input.messId,
          dailyRatePaise: input.dailyRatePaise,
          minAbsenceDays: input.minAbsenceDays,
          effectiveFrom: effectiveFromDate,
          effectiveUntil: null,
          claimDeadlineDays: input.claimDeadlineDays,
          maxAbsenceDays: input.maxAbsenceDays,
          documentRequired: input.documentRequired,
          createdById: actorId,
        },
      });

      await auditService.log({
        actorType: "ADMIN",
        actorId,
        action: "REIMBURSEMENT_POLICY_CREATED",
        entityType: "ReimbursementPolicy",
        entityId: newPolicy.id,
        after: {
          dailyRatePaise: newPolicy.dailyRatePaise,
          effectiveFrom: input.effectiveFrom,
          closedPreviousPolicyId: previousActive?.id,
        },
        ip,
      });

      return newPolicy;
    });
  }
}

export const policyService = new PolicyService();
