-- One row per (launch context, user): what the LMS said about this user in
-- this course at their most recent launch. The session token (ltik) only
-- identifies the launch; course and role are always read from here, so a
-- user's rights in one course never carry over to another, and a launch
-- stops being honoured after LTI_SESSION_HOURS.
CREATE TABLE public.launch_contexts (
    platform_id integer NOT NULL REFERENCES public.lti_platforms(id) ON DELETE CASCADE,
    ltik_context_id text NOT NULL,
    lti_user_id text NOT NULL,
    user_id integer REFERENCES public.users(id) ON DELETE CASCADE,
    course_id integer REFERENCES public.courses(id) ON DELETE CASCADE,
    lti_context_id text,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    is_instructor boolean DEFAULT false NOT NULL,
    is_instance_admin boolean DEFAULT false NOT NULL,
    launched_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT launch_contexts_pkey PRIMARY KEY (platform_id, ltik_context_id, lti_user_id)
);

CREATE INDEX idx_launch_contexts_launched ON public.launch_contexts USING btree (launched_at);
