import swaggerJsdoc from "swagger-jsdoc";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;

// ── Reusable response helpers ─────────────────────────────────────────────────
const jsonContent = (schema) => ({
  content: { "application/json": { schema } },
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Nagarsewa API",
      version: "2.0.0",
      description:
        "REST API for Nagarsewa — a civic issue reporting and municipal transparency platform.",
      contact: { name: "Nagarsewa" },
    },
    servers: [
      {
        url: "http://13.233.90.104",
        description: "Live backend server",
      },
      {
        url: `http://localhost:${PORT}`,
        description: "Local development server",
      },
    ],

    // ── Security ──────────────────────────────────────────────────────────────
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT from POST /api/auth/login",
        },
      },

      // ── Shared schemas ──────────────────────────────────────────────────────
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
          },
        },

        // Full user as returned by most endpoints (no password)
        UserFull: {
          type: "object",
          properties: {
            _id:              { type: "string",  example: "665f1a2b3c4d5e6f7a8b9c0d" },
            fullName:         { type: "string",  example: "Ram Bahadur Thapa" },
            email:            { type: "string",  format: "email", example: "ram@example.com" },
            phone:            { type: "string",  example: "9841234567" },
            currentAddress:   { type: "string",  example: "Kathmandu, Bagmati Province" },
            permanentAddress: { type: "string",  example: "Pokhara, Gandaki Province" },
            kycType:          { type: "string",  enum: ["citizenship", "pan"] },
            citizenshipNumber:{ type: "string",  example: "27-01-78-12345" },
            kycFrontImage: {
              type: "object",
              properties: {
                url:      { type: "string" },
                publicId: { type: "string" },
              },
            },
            kycBackImage: {
              type: "object",
              properties: {
                url:      { type: "string" },
                publicId: { type: "string" },
              },
            },
            isVerified: { type: "boolean", example: true },
            status:     { type: "string",  enum: ["active", "suspended"], example: "active" },
            role:       { type: "string",  enum: ["user", "admin"],       example: "user" },
            createdAt:  { type: "string",  format: "date-time" },
            updatedAt:  { type: "string",  format: "date-time" },
          },
        },

        // Minimal user as returned in login / register responses
        UserPublic: {
          type: "object",
          properties: {
            _id:        { type: "string", example: "665f1a2b3c4d5e6f7a8b9c0d" },
            fullName:   { type: "string", example: "Ram Bahadur Thapa" },
            email:      { type: "string", format: "email", example: "ram@example.com" },
            phone:      { type: "string", example: "9841234567" },
            role:       { type: "string", enum: ["user", "admin"], example: "user" },
            isVerified: { type: "boolean", example: true },
          },
        },

        // ── Auth ──────────────────────────────────────────────────────────────
        RegisterResponse: {
          allOf: [
            ref("SuccessResponse"),
            { type: "object", properties: { data: ref("UserPublic") } },
          ],
        },
        LoginRequest: {
          type: "object",
          required: ["identifier", "password"],
          properties: {
            identifier: { type: "string", description: "Email or phone", example: "9841234567" },
            password:   { type: "string", format: "password", example: "MySecurePass1" },
          },
        },
        LoginResponse: {
          allOf: [
            ref("SuccessResponse"),
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    token: { type: "string", description: "JWT — valid for 7 days" },
                    user:  ref("UserPublic"),
                  },
                },
              },
            },
          ],
        },
        UpdateProfileRequest: {
          type: "object",
          properties: {
            fullName:         { type: "string", example: "Ram B. Thapa" },
            phone:            { type: "string", example: "9851234567" },
            currentAddress:   { type: "string", example: "Lalitpur" },
            permanentAddress: { type: "string", example: "Bhaktapur" },
          },
        },

        // ── User self-service ─────────────────────────────────────────────────
        ChangePasswordRequest: {
          type: "object",
          required: ["currentPassword", "newPassword", "confirmNewPassword"],
          properties: {
            currentPassword:    { type: "string", format: "password", example: "OldPass123" },
            newPassword:        { type: "string", format: "password", minLength: 8, example: "NewPass456" },
            confirmNewPassword: { type: "string", format: "password", example: "NewPass456" },
          },
        },
        DeactivateRequest: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", format: "password", description: "Current password for confirmation" },
          },
        },

        // ── Admin ─────────────────────────────────────────────────────────────
        PaginatedUsers: {
          allOf: [
            ref("SuccessResponse"),
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    users: { type: "array", items: ref("UserFull") },
                    pagination: {
                      type: "object",
                      properties: {
                        total: { type: "integer", example: 42 },
                        page:  { type: "integer", example: 1 },
                        limit: { type: "integer", example: 20 },
                        pages: { type: "integer", example: 3 },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        ChangeRoleRequest: {
          type: "object",
          required: ["role"],
          properties: {
            role: { type: "string", enum: ["user", "admin"], example: "admin" },
          },
        },
        VerifyUserRequest: {
          type: "object",
          required: ["isVerified"],
          properties: {
            isVerified: { type: "boolean", example: true },
          },
        },
        SetStatusRequest: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "suspended"], example: "suspended" },
          },
        },
        UserResponse: {
          allOf: [
            ref("SuccessResponse"),
            { type: "object", properties: { data: ref("UserFull") } },
          ],
        },
        Report: {
          type: "object",
          properties: {
            _id: { type: "string" },
            reporter: { type: "string" },
            title: { type: "string", minLength: 5, maxLength: 150 },
            description: { type: "string", minLength: 10, maxLength: 5000 },
            category: { type: "string", enum: ["road", "pothole", "sanitation", "waste_management", "water_supply", "drainage", "sewerage", "street_lighting", "public_infrastructure", "electricity", "environment", "traffic", "other"] },
            location: { type: "object", required: ["type", "coordinates"], properties: { type: { type: "string", enum: ["Point"] }, coordinates: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" }, example: [85.324, 27.7172] } } },
            images: { type: "array", maxItems: 5, items: { type: "object", properties: { url: { type: "string", format: "uri" }, publicId: { type: "string" }, format: { type: "string" }, bytes: { type: "integer" } } } },
            issue: { type: "string", nullable: true },
            status: { type: "string", enum: ["submitted", "under_review", "assigned", "in_progress", "resolved", "closed", "withdrawn", "rejected"] },
            statusHistory: { type: "array", items: { type: "object" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },

    // ── Paths ─────────────────────────────────────────────────────────────────
    paths: {

      // ── Auth ─────────────────────────────────────────────────────────────────
      "/api/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          description:
            "Creates a citizen account with KYC document upload. For citizenship KYC both front and back images are required; PAN only needs the front.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["fullName","email","phone","currentAddress","permanentAddress","password","confirmPassword","kycType","kycFrontImage"],
                  properties: {
                    fullName:         { type: "string",  example: "Ram Bahadur Thapa" },
                    email:            { type: "string",  format: "email", example: "ram@example.com" },
                    phone:            { type: "string",  example: "9841234567" },
                    currentAddress:   { type: "string",  example: "Kathmandu" },
                    permanentAddress: { type: "string",  example: "Pokhara" },
                    password:         { type: "string",  format: "password", minLength: 8 },
                    confirmPassword:  { type: "string",  format: "password" },
                    kycType:          { type: "string",  enum: ["citizenship","pan"], example: "citizenship" },
                    citizenshipNumber:{ type: "string",  description: "Required when kycType=citizenship", example: "27-01-78-12345" },
                    kycFrontImage:    { type: "string",  format: "binary", description: "JPG/JPEG, PNG or WebP, max 5 MB" },
                    kycBackImage:     { type: "string",  format: "binary", description: "Required when kycType=citizenship" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Registered successfully", ...jsonContent(ref("RegisterResponse")) },
            400: { description: "Validation error",        ...jsonContent(ref("ErrorResponse")) },
            409: { description: "Email or phone taken",    ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",            ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login with email or phone",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("LoginRequest") } },
          },
          responses: {
            200: { description: "Login successful",      ...jsonContent(ref("LoginResponse")) },
            400: { description: "Missing fields",        ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Invalid credentials",   ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",          ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/auth/update-profile": {
        put: {
          tags: ["Auth"],
          summary: "Update own profile fields",
          description: "Updates fullName, phone, currentAddress, permanentAddress. Email, password, role, and KYC cannot be changed here.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("UpdateProfileRequest") } },
          },
          responses: {
            200: { description: "Profile updated",       ...jsonContent(ref("UserResponse")) },
            400: { description: "No valid fields",       ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Unauthorized",          ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Suspended account",     ...jsonContent(ref("ErrorResponse")) },
            409: { description: "Phone already taken",   ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",          ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      // ── User self-service ─────────────────────────────────────────────────
      "/api/users/me": {
        get: {
          tags: ["User"],
          summary: "Get own full profile",
          description: "Returns the complete profile of the authenticated user including addresses, KYC status, and account status.",
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: "Profile returned",  ...jsonContent(ref("UserResponse")) },
            401: { description: "Unauthorized",      ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Suspended account", ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",      ...jsonContent(ref("ErrorResponse")) },
          },
        },
        delete: {
          tags: ["User"],
          summary: "Deactivate own account",
          description: "Soft-deletes the account by setting status to 'suspended'. Requires password confirmation.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("DeactivateRequest") } },
          },
          responses: {
            200: { description: "Account deactivated", ...jsonContent(ref("SuccessResponse")) },
            400: { description: "Missing password",    ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Wrong password",      ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Suspended account",   ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",        ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/users/me/password": {
        patch: {
          tags: ["User"],
          summary: "Change own password",
          description: "Verifies the current password then replaces it. All active sessions using the old token remain valid until expiry.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("ChangePasswordRequest") } },
          },
          responses: {
            200: { description: "Password changed",       ...jsonContent(ref("SuccessResponse")) },
            400: { description: "Validation error",       ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Wrong current password", ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Suspended account",      ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",           ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      // ── Admin ─────────────────────────────────────────────────────────────
      ...(() => {
        const sec = [{ BearerAuth: [] }];
        const idp = { in: "path", name: "id", required: true, schema: { type: "string" } };
        const idem = { in: "header", name: "Idempotency-Key", schema: { type: "string" } };
        const q = (name, type = "string") => ({ in: "query", name, schema: { type } });
        const r = (d) => ({ description: d });
        const body = (props, required = []) => ({ content: { "application/json": { schema: { type: "object", additionalProperties: false, required, properties: props } } } });
        const errs = { 400: r("Invalid input / unknown fields"), 403: r("Role or ward scope not permitted"), 404: r("Not found or outside your scope"), 409: r("Conflict (concurrent change / already in state)"), 422: r("Invalid transition or missing reason") };
        return {
          "/api/admin/dashboard": { get: { tags: ["Admin Operations"], summary: "Operational overview for the caller's scope (ward_admin: own ward; admin/super_admin: all)", security: sec, responses: { 200: r("Dashboard"), 403: r("Not staff") } } },
          "/api/admin/issues": { get: { tags: ["Admin Operations"], summary: "Issue queue (default: open..resolved; sorted by priority)", security: sec, parameters: ["page", "limit", "category", "status", "priority", "department", "assignedTo", "ward", "from", "to", "search", "sort(priority|deadline|newest|oldest|last_reported)", "unassigned(true)", "overdue(true)", "includeClosed(true)", "includeMerged(true)"].map((n) => q(n.split("(")[0])), responses: { 200: r("Issues with overdue flag and availableTransitions"), 400: r("Invalid query"), 403: r("Outside ward scope") } } },
          "/api/admin/reports": { get: { tags: ["Admin Operations"], summary: "Report queue (default: status=submitted, oldest first)", security: sec, parameters: ["page", "limit", "status", "category", "matching", "issue", "unlinked", "ward", "sort"].map((n) => q(n)), responses: { 200: r("Reports"), 400: r("Invalid query"), 403: r("Outside ward scope") } } },
          "/api/admin/reports/{id}/review": { patch: { tags: ["Admin Operations"], summary: "Accept (submitted->under_review) or reject (reason required, citizen-visible) a report", security: sec, parameters: [idp], requestBody: body({ decision: { type: "string", enum: ["accept", "reject"] }, reason: { type: "string" } }, ["decision"]), responses: { 200: r("Reviewed"), ...errs } } },
          "/api/admin/issues/{id}/status": { patch: { tags: ["Admin Operations"], summary: "Change issue status through validated transitions", security: sec, parameters: [idp, idem], requestBody: body({ status: { type: "string" }, reason: { type: "string" }, resolutionSummary: { type: "string" }, expectedStatus: { type: "string" } }, ["status"]), responses: { 200: r("Updated issue + events"), ...errs } } },
          "/api/admin/issues/{id}/assign": { patch: { tags: ["Admin Operations"], summary: "Assign/reassign/clear department and/or staff member", security: sec, parameters: [idp, idem], requestBody: body({ department: { type: "string", nullable: true }, assignedTo: { type: "string", nullable: true }, reason: { type: "string" }, expectedStatus: { type: "string" } }), responses: { 200: r("Updated issue + events"), ...errs } } },
          "/api/admin/issues/{id}/priority": { patch: { tags: ["Admin Operations"], summary: "Set priority (reason required for high/critical)", security: sec, parameters: [idp, idem], requestBody: body({ priority: { type: "string", enum: ["low", "medium", "high", "critical"] }, reason: { type: "string" }, expectedStatus: { type: "string" } }, ["priority"]), responses: { 200: r("Updated issue + events"), ...errs } } },
          "/api/admin/issues/{id}/deadline": { patch: { tags: ["Admin Operations"], summary: "Set, revise or clear (null) the resolution deadline; future dates only, reason required to revise/clear", security: sec, parameters: [idp, idem], requestBody: body({ deadline: { type: "string", format: "date-time", nullable: true }, reason: { type: "string" }, expectedStatus: { type: "string" } }, ["deadline"]), responses: { 200: r("Updated issue + events"), ...errs } } },
        };
      })(),
      ...(() => {
        const sec = [{ BearerAuth: [] }];
        const q = (name, description) => ({ in: "query", name, schema: { type: "string" }, ...(description && { description }) });
        const common = [q("from", "ISO date or timestamp; date-only = Nepal calendar day"), q("to", "ISO date or timestamp (inclusive)"), q("ward", "super admin only; ward_admin is fixed to own ward"), q("category")];
        const r = (d) => ({ description: d });
        const errs = { 400: r("Invalid filter"), 401: r("Unauthorized"), 403: r("Not staff / outside ward scope") };
        const get = (summary, parameters) => ({ get: { tags: ["Analytics"], summary, security: sec, parameters, responses: { 200: r("Aggregates only (no personal data); includes applied filters"), ...errs } } });
        return {
          "/api/analytics/overview": get("Issue/report totals, open vs resolved work, overdue and escalated counts", common),
          "/api/analytics/issues": get("Issue breakdown (groupBy category|status|priority|ward|department)", [...common, q("department"), q("groupBy")]),
          "/api/analytics/resolution-time": get("Resolution time (avg/median/p90/min/max, deadline compliance) for issues resolved in the period (default last 30 days, max 366)", [...common, q("department"), q("groupBy", "none|category|priority|ward|department")]),
          "/api/analytics/department-performance": get("Workload and outcome per department for issues created in the period", [...common, q("department")]),
          "/api/analytics/trends": get("Zero-filled time series of reports created, issues created, issues resolved (interval day|week|month, Nepal time, default last 30 days, max 366)", [...common, q("interval")]),
        };
      })(),
      "/api/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "List all users",
          description: "Paginated, filterable list of all users. Admin only.",
          security: [{ BearerAuth: [] }],
          parameters: [
            { in: "query", name: "page",       schema: { type: "integer", default: 1 },   description: "Page number" },
            { in: "query", name: "limit",      schema: { type: "integer", default: 20 },  description: "Results per page (max 100)" },
            { in: "query", name: "role",       schema: { type: "string",  enum: ["user","admin"] }, description: "Filter by role" },
            { in: "query", name: "status",     schema: { type: "string",  enum: ["active","suspended"] }, description: "Filter by account status" },
            { in: "query", name: "isVerified", schema: { type: "boolean" }, description: "Filter by KYC verification" },
            { in: "query", name: "search",     schema: { type: "string" }, description: "Search fullName, email, or phone" },
          ],
          responses: {
            200: { description: "User list",         ...jsonContent(ref("PaginatedUsers")) },
            401: { description: "Unauthorized",      ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Not an admin",      ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",      ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/admin/users/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get a single user by ID",
          security: [{ BearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" }, description: "MongoDB user _id" },
          ],
          responses: {
            200: { description: "User found",       ...jsonContent(ref("UserResponse")) },
            400: { description: "Invalid ID",       ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Unauthorized",     ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Not an admin",     ...jsonContent(ref("ErrorResponse")) },
            404: { description: "User not found",   ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",     ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/admin/users/{id}/role": {
        patch: {
          tags: ["Admin"],
          summary: "Change a user's role",
          description: "Admins cannot demote themselves.",
          security: [{ BearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("ChangeRoleRequest") } },
          },
          responses: {
            200: { description: "Role updated",    ...jsonContent(ref("UserResponse")) },
            400: { description: "Invalid input",   ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Unauthorized",    ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Not an admin",    ...jsonContent(ref("ErrorResponse")) },
            404: { description: "User not found",  ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",    ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/admin/users/{id}/verify": {
        patch: {
          tags: ["Admin"],
          summary: "Approve or reject KYC verification",
          security: [{ BearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("VerifyUserRequest") } },
          },
          responses: {
            200: { description: "Verification updated", ...jsonContent(ref("UserResponse")) },
            400: { description: "Invalid input",        ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Unauthorized",         ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Not an admin",         ...jsonContent(ref("ErrorResponse")) },
            404: { description: "User not found",       ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",         ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      "/api/admin/users/{id}/status": {
        patch: {
          tags: ["Admin"],
          summary: "Activate or suspend an account",
          description: "Admins cannot suspend themselves.",
          security: [{ BearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("SetStatusRequest") } },
          },
          responses: {
            200: { description: "Status updated",      ...jsonContent(ref("UserResponse")) },
            400: { description: "Invalid input",       ...jsonContent(ref("ErrorResponse")) },
            401: { description: "Unauthorized",        ...jsonContent(ref("ErrorResponse")) },
            403: { description: "Not an admin",        ...jsonContent(ref("ErrorResponse")) },
            404: { description: "User not found",      ...jsonContent(ref("ErrorResponse")) },
            500: { description: "Server error",        ...jsonContent(ref("ErrorResponse")) },
          },
        },
      },

      // ── Wards ────────────────────────────────────────────────────────────────
      "/api/wards": {
        get: {
          tags: ["Wards"],
          summary: "List municipal wards",
          description: "Retrieve list of active wards with filtering and search.",
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 20 } },
            { in: "query", name: "search", schema: { type: "string" } },
            { in: "query", name: "municipality", schema: { type: "string" } },
          ],
          responses: {
            200: { description: "Wards retrieved successfully" },
            500: { description: "Server error" },
          },
        },
        post: {
          tags: ["Wards"],
          summary: "Create a municipal ward (Super Admin only)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "wardNumber", "wardCode"],
                  properties: {
                    name: { type: "string", example: "Ward 5" },
                    wardNumber: { type: "integer", example: 5 },
                    wardCode: { type: "string", example: "KTM-W05" },
                    municipality: { type: "string", example: "Kathmandu Metropolitan City" },
                    district: { type: "string", example: "Kathmandu" },
                    province: { type: "string", example: "Bagmati" },
                    description: { type: "string", example: "Central area" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Ward created successfully" },
            400: { description: "Validation error" },
            403: { description: "Forbidden - Super Admin required" },
            409: { description: "Duplicate ward code or number" },
          },
        },
      },

      "/api/wards/{id}": {
        get: {
          tags: ["Wards"],
          summary: "Get ward details",
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Ward details retrieved" },
            404: { description: "Ward not found" },
          },
        },
        patch: {
          tags: ["Wards"],
          summary: "Update ward (Super Admin only)",
          security: [{ BearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Ward updated" },
            403: { description: "Forbidden" },
            404: { description: "Ward not found" },
          },
        },
      },

      "/api/wards/{id}/issues": {
        get: {
          tags: ["Wards"],
          summary: "Get ward issues (Ward Admin / Super Admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Ward issues retrieved" },
            403: { description: "Forbidden - Ward scope restriction" },
          },
        },
      },

      "/api/wards/{id}/dashboard": {
        get: {
          tags: ["Wards"],
          summary: "Get ward operational dashboard (Ward Admin / Super Admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Ward dashboard retrieved" },
            403: { description: "Forbidden - Ward scope restriction" },
          },
        },
      },

      // ── Departments ──────────────────────────────────────────────────────────
      "/api/departments": {
        get: {
          tags: ["Departments"],
          summary: "List municipal departments",
          parameters: [
            { in: "query", name: "category", schema: { type: "string" } },
            { in: "query", name: "search", schema: { type: "string" } },
          ],
          responses: {
            200: { description: "Departments retrieved" },
          },
        },
        post: {
          tags: ["Departments"],
          summary: "Create department (Super Admin only)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "code"],
                  properties: {
                    name: { type: "string", example: "Road Maintenance" },
                    code: { type: "string", example: "ROAD-MAINT" },
                    description: { type: "string" },
                    categories: { type: "array", items: { type: "string" }, example: ["road", "pothole"] },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Department created" },
            400: { description: "Invalid categories or missing fields" },
            409: { description: "Duplicate department code" },
          },
        },
      },

      "/api/departments/{id}": {
        get: {
          tags: ["Departments"],
          summary: "Get department details",
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Department retrieved" } },
        },
        patch: {
          tags: ["Departments"],
          summary: "Update department (Super Admin only)",
          security: [{ BearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Department updated" } },
        },
        delete: {
          tags: ["Departments"],
          summary: "Safe deactivate department (Super Admin only)",
          security: [{ BearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Department deactivated" } },
        },
      },

      "/api/reports": {
        post: {
          tags: ["Reports"], summary: "Submit a citizen report", security: [{ BearerAuth: [] }],
          requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["title", "description", "category", "location"], properties: { title: { type: "string" }, description: { type: "string" }, category: { type: "string", enum: ["road", "pothole", "sanitation", "waste_management", "water_supply", "drainage", "sewerage", "street_lighting", "public_infrastructure", "electricity", "environment", "traffic", "other"] }, location: { type: "string", description: "JSON GeoJSON Point, coordinates are [longitude, latitude]" }, images: { type: "array", items: { type: "string", format: "binary" }, maxItems: 5 } } } } } },
          responses: { 201: { description: "Report created" }, 400: { description: "Validation error" }, 401: { description: "Unauthorized" }, 413: { description: "Upload too large" }, 415: { description: "Unsupported image" } },
        },
        get: {
          tags: ["Reports"], summary: "List scoped administrative report queue", security: [{ BearerAuth: [] }],
          parameters: [{ in: "query", name: "page", schema: { type: "integer", default: 1 } }, { in: "query", name: "limit", schema: { type: "integer", default: 10, maximum: 50 } }, { in: "query", name: "status", schema: { type: "string" } }, { in: "query", name: "category", schema: { type: "string" } }, { in: "query", name: "sort", schema: { type: "string", enum: ["newest", "oldest"] } }],
          responses: { 200: { description: "Report queue" }, 403: { description: "Staff access required" } },
        },
      },
      "/api/reports/my": { get: { tags: ["Reports"], summary: "List own reports", security: [{ BearerAuth: [] }], responses: { 200: { description: "Citizen report list" }, 401: { description: "Unauthorized" } } } },
      "/api/reports/{id}": {
        get: { tags: ["Reports"], summary: "Get an authorized report", security: [{ BearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { 200: { description: "Report details" }, 404: { description: "Report not found" } } },
        patch: { tags: ["Reports"], summary: "Edit a submitted report", security: [{ BearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, category: { type: "string" }, location: { type: "object" } } } }, "multipart/form-data": { schema: { type: "object" } } } }, responses: { 200: { description: "Report updated" }, 409: { description: "Report is no longer editable" } } },
        delete: { tags: ["Reports"], summary: "Withdraw a submitted report", security: [{ BearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { 200: { description: "Report withdrawn" }, 409: { description: "Report is no longer withdrawable" } } },
      },
      ...(() => {
        const sec = [{ BearerAuth: [] }];
        const idp = { in: "path", name: "id", required: true, schema: { type: "string" } };
        const q = (name, type = "string") => ({ in: "query", name, schema: { type } });
        const r = (d) => ({ description: d });
        return {
          "/api/issues": { get: { tags: ["Issues"], summary: "List issues (paginated; ward_admin scoped; merged hidden by default)", security: sec, parameters: ["page", "limit", "category", "status", "priority", "municipality", "ward", "department", "from", "to", "sort", "search"].map((n) => q(n)), responses: { 200: r("Issue list"), 400: r("Invalid query"), 401: r("Unauthorized") } } },
          "/api/issues/nearby": { get: { tags: ["Issues"], summary: "Issues near a point (2dsphere, distance in metres)", security: sec, parameters: [q("longitude", "number"), q("latitude", "number"), q("radius", "number"), q("category"), q("municipality"), q("ward"), q("page"), q("limit")], responses: { 200: r("Nearby issues"), 400: r("Invalid coordinates or radius") } } },
          "/api/issues/reviews": { get: { tags: ["Issues"], summary: "Staff: uncertain-match review queue", security: sec, parameters: [q("status"), q("page"), q("limit")], responses: { 200: r("Review queue"), 403: r("Staff only") } } },
          "/api/issues/reviews/{reviewId}/resolve": { post: { tags: ["Issues"], summary: "Staff: link / new_issue / defer / request_verification", security: sec, parameters: [{ ...idp, name: "reviewId" }], requestBody: { content: { "application/json": { schema: { type: "object", required: ["action", "reason"], properties: { action: { type: "string", enum: ["link", "new_issue", "defer", "request_verification"] }, issueId: { type: "string" }, reason: { type: "string" } } } } } }, responses: { 200: r("Review updated"), 409: r("Already resolved / not eligible") } } },
          "/api/issues/reconcile": { post: { tags: ["Issues"], summary: "Admin: recompute denormalized report counts", security: sec, responses: { 200: r("Reconciled"), 403: r("Admin only") } } },
          "/api/issues/{id}": {
            get: { tags: ["Issues"], summary: "Issue details (merged issues return the canonical issue id)", security: sec, parameters: [idp], responses: { 200: r("Issue"), 404: r("Not found") } },
            patch: { tags: ["Issues"], summary: "Staff: update summary/priority/department/deadline/status (approved transitions only)", security: sec, parameters: [idp], requestBody: { content: { "application/json": { schema: { type: "object", properties: { summary: { type: "string" }, priority: { type: "string" }, priorityReason: { type: "string" }, department: { type: "string", nullable: true }, assignedTo: { type: "string", nullable: true }, deadline: { type: "string", nullable: true }, status: { type: "string", enum: ["open", "under_review", "assigned", "in_progress", "resolved", "closed", "cancelled"] }, resolutionSummary: { type: "string", description: "Required when status=resolved (public text)" }, expectedStatus: { type: "string", description: "Optimistic check; 409 if the issue is in another status" }, reason: { type: "string", description: "Required for reversals/reopen/cancel (staff-only)" } } } } } }, responses: { 200: r("Updated; events created atomically"), 403: r("Role/scope not permitted for this transition"), 409: r("Concurrent modification / already in that status"), 422: r("Invalid transition, missing reason/resolutionSummary/department") } },
          },
          "/api/issues/{id}/reports": { get: { tags: ["Issues"], summary: "Reports linked to an issue (citizens see only their own)", security: sec, parameters: [idp, q("page"), q("limit")], responses: { 200: r("Reports") } } },
          "/api/issues/{id}/events": {
            get: { tags: ["Issues"], summary: "Issue timeline (citizens: public events only; staff/admin: + internal, per audience serializer). Ordered timestamp ASC, _id ASC", security: sec, parameters: [idp, q("page", "integer"), q("limit", "integer"), q("eventType"), q("visibility")], responses: { 200: r("Timeline with pagination {page,limit,total,totalPages}"), 400: r("Invalid query"), 403: r("Citizen requested internal events"), 404: r("Issue not found / out of scope") } },
            post: { tags: ["Issues"], summary: "Staff: add a manual note (eventType note_added only). Supports Idempotency-Key header", security: sec, parameters: [idp, { in: "header", name: "Idempotency-Key", schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", required: ["eventType", "summary"], additionalProperties: false, properties: { eventType: { type: "string", enum: ["note_added"] }, summary: { type: "string", maxLength: 1000 }, visibility: { type: "string", enum: ["public", "internal"], default: "internal" } } } } } }, responses: { 201: r("Event created"), 200: r("Replay of an earlier Idempotency-Key"), 400: r("Invalid or forbidden fields"), 403: r("Not staff"), 409: r("Issue merged") } },
          },
          "/api/issues/{id}/similar": { get: { tags: ["Issues"], summary: "Staff: unconfirmed similar-issue candidates", security: sec, parameters: [idp, q("radius", "number"), q("threshold", "number"), q("limit"), q("category")], responses: { 200: r("Candidates"), 403: r("Staff only") } } },
          "/api/issues/{id}/merge": { post: { tags: ["Issues"], summary: "Admin: merge a duplicate issue into a canonical issue", security: sec, parameters: [idp], requestBody: { content: { "application/json": { schema: { type: "object", required: ["targetIssueId", "reason"], properties: { targetIssueId: { type: "string" }, reason: { type: "string" }, reviewedMatching: { type: "object" } } } } } }, responses: { 200: r("Merged"), 409: r("Already merged"), 422: r("Invalid merge / cycle") } } },
        };
      })(),
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
