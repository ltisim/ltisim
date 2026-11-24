// LTI role classification. Roles arrive in the platform-signed launch, so a
// user cannot forge them; what matters is matching them exactly. Substring
// matching is wrong: "institution/person#Instructor" (teaches *some* course)
// must not grant instructor rights in *this* course.
const LIS = 'http://purl.imsglobal.org/vocab/lis/v2';

// Course-level roles that may author and grade in the launched course.
const COURSE_INSTRUCTOR_ROLES = new Set([
  `${LIS}/membership#Instructor`,
  `${LIS}/membership#Administrator`,
  `${LIS}/membership#ContentDeveloper`,
  `${LIS}/membership/Instructor#TeachingAssistant`,
  // Short and LTI 1.1-style forms some platforms still send
  'Instructor',
  'TeachingAssistant',
  'ContentDeveloper',
  'urn:lti:role:ims/lis/Instructor',
  'urn:lti:role:ims/lis/TeachingAssistant',
  'urn:lti:role:ims/lis/ContentDeveloper',
].map((r) => r.toLowerCase()));

// Institution- or system-level administrators of the LMS itself.
const INSTANCE_ADMIN_ROLES = new Set([
  `${LIS}/institution/person#Administrator`,
  `${LIS}/system/person#Administrator`,
  `${LIS}/system/person#SysAdmin`,
  `${LIS}/system/person#AccountAdmin`,
].map((r) => r.toLowerCase()));

const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * @param {string[]} roles   roles claim from the launch
 * @param {object}   who     { ltiUserId, email } for the allowlists
 * @param {object}   env     process.env (injectable for tests)
 * @returns {{ isInstanceAdmin: boolean, isInstructor: boolean }}
 */
function classifyRoles(roles, who = {}, env = process.env) {
  const normalized = (Array.isArray(roles) ? roles : []).map((r) => String(r).toLowerCase());

  // INSTANCE_ADMIN_ROLES=false stops trusting LMS administrator roles and
  // leaves only the explicit allowlists.
  const byRole = env.INSTANCE_ADMIN_ROLES !== 'false' && normalized.some((r) => INSTANCE_ADMIN_ROLES.has(r));
  const byUserId = !!who.ltiUserId && list(env.INSTANCE_ADMIN_USER_IDS).includes(String(who.ltiUserId).toLowerCase());
  const byEmail = !!who.email && list(env.INSTANCE_ADMIN_EMAILS).includes(String(who.email).toLowerCase());
  const isInstanceAdmin = byRole || byUserId || byEmail;

  // Instance administrators can manage any course they launch into (an LMS
  // admin is usually not enrolled, so carries no course-level role).
  const isInstructor = isInstanceAdmin || normalized.some((r) => COURSE_INSTRUCTOR_ROLES.has(r));

  return { isInstanceAdmin, isInstructor };
}

module.exports = { classifyRoles };
