import User from "../models/User.js";

export const AUDIENCES = { CITIZEN: "citizen", STAFF: "staff", ADMIN: "admin" };

export const audienceFor = (user) => {
  if (["admin", "super_admin"].includes(user.role)) return AUDIENCES.ADMIN;
  if (user.role === "ward_admin") return AUDIENCES.STAFF;
  return AUDIENCES.CITIZEN;
};

export const visibilitiesFor = (audience) => (audience === AUDIENCES.CITIZEN ? ["public"] : ["public", "internal"]);

const PUBLIC_LABEL = { staff: "Municipal Team", admin: "Municipal Team", system: "NagarSewa", citizen: "Citizen" };

// Loads display names for staff/admin audiences only (name + id; never email/phone).
const loadActorNames = async (events) => {
  const ids = [...new Set(events.map((e) => e.actor?.toString()).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select("fullName").lean();
  return new Map(users.map((u) => [u._id.toString(), u.fullName]));
};

const str = (value) => (value === undefined || value === null ? undefined : value.toString());

const serializeDetails = (details = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(details)) if (value !== undefined && value !== null) out[key] = typeof value === "object" ? value.toString() : value;
  return out;
};

// Explicit allowlists per audience: the raw document is never returned.
export const serializeEvents = async (rawEvents, audience) => {
  const events = rawEvents.map((e) => (e.toObject ? e.toObject() : e));
  const names = audience === AUDIENCES.CITIZEN ? new Map() : await loadActorNames(events);
  return events.map((event) => {
    const base = {
      id: event._id.toString(),
      eventType: event.eventType,
      summary: event.summary,
      visibility: event.visibility,
      actor: { type: event.actorType || "system", displayName: PUBLIC_LABEL[event.actorType || "system"] },
      createdAt: new Date(event.timestamp).toISOString(),
    };
    if (audience === AUDIENCES.CITIZEN) return base;

    const staffView = {
      ...base,
      actor: {
        ...base.actor,
        id: str(event.actor),
        role: event.actorRole,
        ...(event.actor && names.has(event.actor.toString()) && { displayName: names.get(event.actor.toString()) }),
      },
      reason: event.reason || undefined,
      details: serializeDetails(event.details),
      relatedReportId: str(event.relatedReport),
      relatedIssueId: str(event.relatedIssue),
    };
    if (audience === AUDIENCES.STAFF) return staffView;
    return { ...staffView, metadata: event.metadata || {} };
  });
};

export const serializeEvent = async (event, audience) => (await serializeEvents([event.toObject ? event.toObject() : event], audience))[0];
