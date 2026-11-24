// Roles are classified on the server from the LMS launch (exact role
// matching, per course) and returned on the user object.

/** Instructor (or instance administrator) in the launched course. */
export const isInstructor = (user) => !!user?.is_instructor

/** Administrator of the LMS this instance serves. */
export const isInstanceAdmin = (user) => !!user?.is_instance_admin
