import React from 'react'
import { NavLink } from 'react-router-dom'
import { Settings, BookOpen, Users, Inbox, Building2 } from 'lucide-react'

// Shared header + top-level navigation for the instructor pages.
// Pages pass whatever context they have; everything is optional.
function AdminNav({ course, user, pendingCount }) {
  // Course tabs need a course: a launch from the LMS's admin menu has none.
  const courseTabs = user?.has_course === false ? [] : [
    { to: '/admin', label: 'Assignments', icon: BookOpen, end: true },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/review', label: 'Review Queue', icon: Inbox, badge: pendingCount },
  ]
  // Installation-wide settings, for administrators of the LMS only.
  const tabs = user?.is_instance_admin
    ? [...courseTabs, { to: '/admin/instance', label: 'Instance', icon: Building2 }]
    : courseTabs

  return (
    <header className="bg-surface-darker text-white shadow-md">
      <div className="py-5 px-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6" />
          {user?.has_course === false ? 'Instance Administration' : 'Instructor Dashboard'}
        </h1>
        {course && <h2 className="text-base text-white/80 mt-1">{course.name}</h2>}
        {user && <p className="text-sm text-white/80 mt-1">Welcome, {user.name}</p>}
      </div>
      <nav className="px-8 flex gap-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-4 py-2.5 rounded-t-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
                isActive ? 'bg-gray-100 text-surface-dark' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`
            }
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {Number(tab.badge) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-amber-400 text-amber-900 rounded-full text-xs font-semibold leading-none">
                {tab.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

export default AdminNav
