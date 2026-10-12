import Department from "../models/Department.js";
import User from "../models/User.js";
import { AppError } from "../utils/AppError.js";

const ASSIGNABLE_STATUSES = ["open", "under_review", "assigned", "in_progress"];
const STAFF_ROLES = ["ward_admin", "admin", "super_admin"];

// Validates department / assignee changes and returns the $set fragment plus event description.
// Scope rules: department must be active, in the issue's municipality and handle its category;
// an individual assignee must be an active staff member whose ward scope covers the issue.
export const planAssignment = async ({ issue, user, departmentId, assigneeId, session }) => {
  if (!ASSIGNABLE_STATUSES.includes(issue.status)) {
    throw new AppError(422, `Issues in status "${issue.status}" cannot be (re)assigned`, "INVALID_ASSIGNMENT");
  }
  const result = { set: {}, events: [] };

  if (departmentId !== undefined && String(departmentId ?? "") !== String(issue.department ?? "")) {
    let department = null;
    if (departmentId) {
      department = await Department.findById(departmentId).session(session).lean();
      if (!department || !department.isActive) throw new AppError(404, "Department not found");
      if (!issue.municipality || department.municipality !== issue.municipality) throw new AppError(422, "Department does not belong to the issue's municipality", "DEPARTMENT_SCOPE");
      if (department.categories.length && !department.categories.includes(issue.category)) throw new AppError(422, "Department does not handle this category", "DEPARTMENT_SCOPE");
    }
    Object.assign(result.set, { department: departmentId ?? null, assignedAt: departmentId ? new Date() : null, assignedBy: departmentId ? user._id : null });
    result.departmentAfter = departmentId ?? null;
    result.events.push({
      eventType: "department_assigned",
      details: { previousDepartmentId: issue.department ?? undefined, newDepartmentId: departmentId ?? undefined, reasonCode: issue.department ? "reassigned" : "assigned" },
      context: { departmentName: department?.name },
      ...(department ? {} : { summary: "The responsible department for this issue was cleared." }),
    });
  }

  if (assigneeId !== undefined && String(assigneeId ?? "") !== String(issue.assignedTo ?? "")) {
    if (assigneeId) {
      const assignee = await User.findById(assigneeId).session(session).select("role wardId status").lean();
      if (!assignee || assignee.status === "suspended" || !STAFF_ROLES.includes(assignee.role)) throw new AppError(422, "Assignee must be an active staff member", "ASSIGNEE_INVALID");
      if (assignee.role === "ward_admin" && assignee.wardId?.toString() !== issue.ward?.toString()) throw new AppError(422, "Assignee's ward does not cover this issue", "ASSIGNEE_SCOPE");
    }
    result.set.assignedTo = assigneeId ?? null;
    result.events.push({
      eventType: "department_assigned",
      visibility: "internal", // individual staff assignment is not disclosed to citizens
      summary: assigneeId ? "The issue was assigned to a staff member." : "The staff assignment was cleared.",
      details: { previousAssigneeId: issue.assignedTo ?? undefined, newAssigneeId: assigneeId ?? undefined, reasonCode: issue.assignedTo ? "reassigned" : "assigned" },
    });
  }
  return result;
};
