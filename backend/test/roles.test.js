const test = require('node:test');
const assert = require('node:assert');
const { classifyRoles } = require('../src/utils/roles');

const LIS = 'http://purl.imsglobal.org/vocab/lis/v2';

test('course teacher is an instructor, not an instance admin', () => {
  const r = classifyRoles([`${LIS}/membership#Instructor`, `${LIS}/institution/person#Instructor`], {}, {});
  assert.deepStrictEqual(r, { isInstanceAdmin: false, isInstructor: true });
});

test('teaching elsewhere grants nothing in a course where the user is a learner', () => {
  const r = classifyRoles([`${LIS}/membership#Learner`, `${LIS}/institution/person#Instructor`], {}, {});
  assert.deepStrictEqual(r, { isInstanceAdmin: false, isInstructor: false });
});

test('Canvas account admin (not enrolled) is instance admin and can manage the course', () => {
  const r = classifyRoles([
    `${LIS}/institution/person#Administrator`,
    `${LIS}/institution/person#Instructor`,
    `${LIS}/system/person#SysAdmin`,
    `${LIS}/system/person#User`,
  ], {}, {});
  assert.deepStrictEqual(r, { isInstanceAdmin: true, isInstructor: true });
});

test('course-level Administrator is an instructor but not an instance admin', () => {
  const r = classifyRoles([`${LIS}/membership#Administrator`], {}, {});
  assert.deepStrictEqual(r, { isInstanceAdmin: false, isInstructor: true });
});

test('teaching assistant is an instructor', () => {
  const r = classifyRoles([`${LIS}/membership/Instructor#TeachingAssistant`], {}, {});
  assert.strictEqual(r.isInstructor, true);
});

test('substring lookalikes are not matched', () => {
  const r = classifyRoles(['http://example.org/roles#NotAnAdministrator', 'administrator-of-nothing'], {}, {});
  assert.deepStrictEqual(r, { isInstanceAdmin: false, isInstructor: false });
});

test('INSTANCE_ADMIN_ROLES=false ignores LMS admin roles', () => {
  const r = classifyRoles([`${LIS}/institution/person#Administrator`], {}, { INSTANCE_ADMIN_ROLES: 'false' });
  assert.deepStrictEqual(r, { isInstanceAdmin: false, isInstructor: false });
});

test('allowlists grant instance admin by user id or email', () => {
  const env = { INSTANCE_ADMIN_ROLES: 'false', INSTANCE_ADMIN_USER_IDS: 'abc-123, zzz', INSTANCE_ADMIN_EMAILS: 'Admin@Example.edu' };
  assert.strictEqual(classifyRoles([], { ltiUserId: 'ABC-123' }, env).isInstanceAdmin, true);
  assert.strictEqual(classifyRoles([], { email: 'admin@example.edu' }, env).isInstanceAdmin, true);
  assert.strictEqual(classifyRoles([], { ltiUserId: 'other', email: 'x@example.edu' }, env).isInstanceAdmin, false);
});

test('no roles means learner', () => {
  assert.deepStrictEqual(classifyRoles(undefined, {}, {}), { isInstanceAdmin: false, isInstructor: false });
});
