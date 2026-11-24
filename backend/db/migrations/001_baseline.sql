-- LTISim baseline schema.
--
-- Application tables only. The LTI library (ltijs) creates and owns its own
-- tables (platforms, idtokens, contexttokens, keys, nonces, state) at boot.
-- Applied once by src/db/migrate.js; later changes go in new numbered files.

CREATE FUNCTION public.fill_platform_id_from_session() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.platform_id IS NULL THEN
    SELECT platform_id INTO NEW.platform_id
    FROM simulation_sessions
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.ai_models (
    id integer NOT NULL,
    model_id text NOT NULL,
    display_name text NOT NULL,
    provider text DEFAULT 'bedrock'::text NOT NULL,
    input_cost_per_1k numeric(10,6),
    output_cost_per_1k numeric(10,6),
    is_available boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public.ai_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ai_models_id_seq OWNED BY public.ai_models.id;

CREATE TABLE public.ai_usage (
    id bigint NOT NULL,
    platform_id integer,
    assignment_id integer,
    session_id integer,
    model_id text NOT NULL,
    call_type text NOT NULL,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    cost_usd numeric(10,6),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public.ai_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ai_usage_id_seq OWNED BY public.ai_usage.id;

CREATE TABLE public.assignment_templates (
    id integer NOT NULL,
    title character varying(300) NOT NULL,
    discipline character varying(100),
    description text,
    payload jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by_user_id integer,
    source_assignment_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.assignment_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.assignment_templates_id_seq OWNED BY public.assignment_templates.id;

CREATE TABLE public.assignments (
    id integer NOT NULL,
    course_id integer,
    lti_context_id character varying(255) NOT NULL,
    lti_resource_link_id character varying(255) NOT NULL,
    title character varying(255),
    platform_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    description text,
    system_prompt text,
    persona_name character varying(255),
    persona_description text,
    scenario_context text,
    conversation_goals jsonb DEFAULT '[]'::jsonb,
    rubric jsonb DEFAULT '[]'::jsonb,
    completion_conditions jsonb DEFAULT '{}'::jsonb,
    ai_provider_config jsonb DEFAULT '{}'::jsonb,
    max_score numeric(5,2) DEFAULT 100,
    is_published boolean DEFAULT true,
    welcome_message text,
    scoring_enabled boolean DEFAULT true,
    max_sessions integer DEFAULT 1,
    feedback_release_mode character varying(50) DEFAULT 'immediate'::character varying,
    assignment_type character varying(32) DEFAULT 'simulation'::character varying NOT NULL,
    learning_content jsonb,
    allow_practice boolean DEFAULT false NOT NULL,
    stages jsonb,
    artifact_config jsonb,
    examiner_config jsonb,
    voice_config jsonb,
    transcribe_vocab jsonb
);

CREATE SEQUENCE public.assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.assignments_id_seq OWNED BY public.assignments.id;

CREATE TABLE public.audit_events (
    id bigint NOT NULL,
    actor_type text NOT NULL,
    actor_id integer,
    event_type text NOT NULL,
    subject_type text,
    subject_id integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public.audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.audit_events_id_seq OWNED BY public.audit_events.id;

CREATE TABLE public.course_enrollments (
    id integer NOT NULL,
    course_id integer,
    user_id integer,
    role character varying(100) NOT NULL,
    first_access timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_access timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.course_enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.course_enrollments_id_seq OWNED BY public.course_enrollments.id;

CREATE TABLE public.courses (
    id integer NOT NULL,
    lti_context_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    platform_id integer,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.courses_id_seq OWNED BY public.courses.id;

CREATE TABLE public.deep_link_tokens (
    ltik_hash text NOT NULL,
    token jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.grade_submissions (
    id integer NOT NULL,
    session_id integer,
    score numeric(5,2) NOT NULL,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'pending'::character varying,
    error_message text,
    platform_id integer NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    next_attempt_at timestamp without time zone,
    last_attempt_at timestamp without time zone,
    comment text,
    score_given numeric,
    score_maximum numeric
);

CREATE SEQUENCE public.grade_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.grade_submissions_id_seq OWNED BY public.grade_submissions.id;

CREATE TABLE public.grading_agreement (
    id integer NOT NULL,
    session_id integer NOT NULL,
    assignment_id integer NOT NULL,
    platform_id integer NOT NULL,
    criterion_id text NOT NULL,
    criterion_name text,
    max_points numeric,
    human_score numeric,
    human_level text,
    ai_score numeric,
    ai_level text,
    ai_confidence character varying(10),
    instructor_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.grading_agreement_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.grading_agreement_id_seq OWNED BY public.grading_agreement.id;

CREATE TABLE public.lti_platforms (
    id integer NOT NULL,
    url character varying(255) NOT NULL,
    client_id character varying(255) NOT NULL,
    auth_endpoint text NOT NULL,
    token_endpoint text NOT NULL,
    key_set_url text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    display_name text,
    registration_status text DEFAULT 'pending'::text NOT NULL,
    registered_at timestamp without time zone,
    first_launch_at timestamp without time zone
);

CREATE SEQUENCE public.lti_platforms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.lti_platforms_id_seq OWNED BY public.lti_platforms.id;

CREATE TABLE public.session_feedback (
    id integer NOT NULL,
    session_id integer,
    instructor_id integer,
    feedback_text text NOT NULL,
    rating integer,
    flagged boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    platform_id integer NOT NULL,
    CONSTRAINT session_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

CREATE SEQUENCE public.session_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.session_feedback_id_seq OWNED BY public.session_feedback.id;

CREATE TABLE public.simulation_interactions (
    id integer NOT NULL,
    session_id integer,
    role character varying(50) NOT NULL,
    content text NOT NULL,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb,
    platform_id integer NOT NULL
);

CREATE SEQUENCE public.simulation_interactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.simulation_interactions_id_seq OWNED BY public.simulation_interactions.id;

CREATE TABLE public.simulation_sessions (
    id integer NOT NULL,
    user_id integer,
    assignment_id integer,
    started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp without time zone,
    score numeric(5,2),
    status character varying(50) DEFAULT 'in_progress'::character varying,
    data jsonb,
    score_breakdown jsonb DEFAULT '{}'::jsonb,
    ai_evaluation jsonb DEFAULT '{}'::jsonb,
    goals_met jsonb DEFAULT '[]'::jsonb,
    completion_reason character varying(100),
    review_status character varying(50) DEFAULT NULL::character varying,
    released_at timestamp without time zone,
    released_by integer,
    lti_grade_context jsonb,
    platform_id integer NOT NULL,
    evaluation_status character varying(30),
    evaluation_attempts integer DEFAULT 0 NOT NULL,
    next_evaluation_at timestamp without time zone,
    evaluation_error text,
    is_practice boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.simulation_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.simulation_sessions_id_seq OWNED BY public.simulation_sessions.id;

CREATE TABLE public.users (
    id integer NOT NULL,
    lti_user_id character varying(255) NOT NULL,
    name character varying(255),
    email character varying(255),
    roles text[],
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    platform_id integer NOT NULL
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.ai_models ALTER COLUMN id SET DEFAULT nextval('public.ai_models_id_seq'::regclass);

ALTER TABLE ONLY public.ai_usage ALTER COLUMN id SET DEFAULT nextval('public.ai_usage_id_seq'::regclass);

ALTER TABLE ONLY public.assignment_templates ALTER COLUMN id SET DEFAULT nextval('public.assignment_templates_id_seq'::regclass);

ALTER TABLE ONLY public.assignments ALTER COLUMN id SET DEFAULT nextval('public.assignments_id_seq'::regclass);

ALTER TABLE ONLY public.audit_events ALTER COLUMN id SET DEFAULT nextval('public.audit_events_id_seq'::regclass);

ALTER TABLE ONLY public.course_enrollments ALTER COLUMN id SET DEFAULT nextval('public.course_enrollments_id_seq'::regclass);

ALTER TABLE ONLY public.courses ALTER COLUMN id SET DEFAULT nextval('public.courses_id_seq'::regclass);

ALTER TABLE ONLY public.grade_submissions ALTER COLUMN id SET DEFAULT nextval('public.grade_submissions_id_seq'::regclass);

ALTER TABLE ONLY public.grading_agreement ALTER COLUMN id SET DEFAULT nextval('public.grading_agreement_id_seq'::regclass);

ALTER TABLE ONLY public.lti_platforms ALTER COLUMN id SET DEFAULT nextval('public.lti_platforms_id_seq'::regclass);

ALTER TABLE ONLY public.session_feedback ALTER COLUMN id SET DEFAULT nextval('public.session_feedback_id_seq'::regclass);

ALTER TABLE ONLY public.simulation_interactions ALTER COLUMN id SET DEFAULT nextval('public.simulation_interactions_id_seq'::regclass);

ALTER TABLE ONLY public.simulation_sessions ALTER COLUMN id SET DEFAULT nextval('public.simulation_sessions_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_model_id_key UNIQUE (model_id);

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assignment_templates
    ADD CONSTRAINT assignment_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_platform_context_resource_key UNIQUE (platform_id, lti_context_id, lti_resource_link_id);

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_course_id_user_id_key UNIQUE (course_id, user_id);

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_platform_lti_context_id_key UNIQUE (platform_id, lti_context_id);

ALTER TABLE ONLY public.deep_link_tokens
    ADD CONSTRAINT deep_link_tokens_pkey PRIMARY KEY (ltik_hash);

ALTER TABLE ONLY public.grade_submissions
    ADD CONSTRAINT grade_submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_session_id_criterion_id_key UNIQUE (session_id, criterion_id);

ALTER TABLE ONLY public.lti_platforms
    ADD CONSTRAINT lti_platforms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lti_platforms
    ADD CONSTRAINT lti_platforms_url_key UNIQUE (url);

ALTER TABLE ONLY public.session_feedback
    ADD CONSTRAINT session_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.simulation_interactions
    ADD CONSTRAINT simulation_interactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.simulation_sessions
    ADD CONSTRAINT simulation_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_platform_lti_user_id_key UNIQUE (platform_id, lti_user_id);

CREATE INDEX idx_ai_usage_assignment ON public.ai_usage USING btree (assignment_id);

CREATE INDEX idx_audit_events_actor ON public.audit_events USING btree (actor_type, actor_id, created_at DESC);

CREATE INDEX idx_audit_events_subject ON public.audit_events USING btree (subject_type, subject_id);

CREATE INDEX idx_deep_link_tokens_expires ON public.deep_link_tokens USING btree (expires_at);

CREATE INDEX idx_grade_submissions_retry ON public.grade_submissions USING btree (next_attempt_at) WHERE ((status)::text = 'pending_retry'::text);

CREATE INDEX idx_grade_submissions_session_latest ON public.grade_submissions USING btree (session_id, id DESC);

CREATE INDEX idx_grading_agreement_assignment ON public.grading_agreement USING btree (assignment_id);

CREATE INDEX idx_grading_agreement_platform ON public.grading_agreement USING btree (platform_id);

CREATE INDEX idx_sessions_evaluation_retry ON public.simulation_sessions USING btree (next_evaluation_at) WHERE ((evaluation_status)::text = 'pending_evaluation'::text);

CREATE TRIGGER fill_platform_id BEFORE INSERT ON public.grade_submissions FOR EACH ROW EXECUTE FUNCTION public.fill_platform_id_from_session();

CREATE TRIGGER fill_platform_id BEFORE INSERT ON public.session_feedback FOR EACH ROW EXECUTE FUNCTION public.fill_platform_id_from_session();

CREATE TRIGGER fill_platform_id BEFORE INSERT ON public.simulation_interactions FOR EACH ROW EXECUTE FUNCTION public.fill_platform_id_from_session();

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.simulation_sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.grade_submissions
    ADD CONSTRAINT grade_submissions_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id);

ALTER TABLE ONLY public.grade_submissions
    ADD CONSTRAINT grade_submissions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.simulation_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id);

ALTER TABLE ONLY public.grading_agreement
    ADD CONSTRAINT grading_agreement_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.simulation_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.session_feedback
    ADD CONSTRAINT session_feedback_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.session_feedback
    ADD CONSTRAINT session_feedback_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id);

ALTER TABLE ONLY public.session_feedback
    ADD CONSTRAINT session_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.simulation_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.simulation_interactions
    ADD CONSTRAINT simulation_interactions_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id);

ALTER TABLE ONLY public.simulation_interactions
    ADD CONSTRAINT simulation_interactions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.simulation_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.simulation_sessions
    ADD CONSTRAINT simulation_sessions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.simulation_sessions
    ADD CONSTRAINT simulation_sessions_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id);

ALTER TABLE ONLY public.simulation_sessions
    ADD CONSTRAINT simulation_sessions_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.simulation_sessions
    ADD CONSTRAINT simulation_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.lti_platforms(id) ON DELETE CASCADE;

CREATE INDEX idx_ai_usage_created ON public.ai_usage USING btree (created_at);

CREATE INDEX idx_audit_events_created ON public.audit_events USING btree (created_at DESC);

ALTER TABLE ONLY public.assignment_templates
    ADD CONSTRAINT assignment_templates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- Instance-wide settings (single row). Secrets stay in the environment.
CREATE TABLE public.instance_settings (
    id boolean DEFAULT true NOT NULL,
    monthly_ai_call_limit integer,
    monthly_ai_budget_usd numeric(10,2),
    alert_email text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT instance_settings_pkey PRIMARY KEY (id),
    CONSTRAINT instance_settings_single_row CHECK (id)
);

INSERT INTO public.instance_settings (id) VALUES (true);

-- De-duplicates the 80% / 100% quota alert emails per month.
CREATE TABLE public.quota_alerts (
    month date NOT NULL,
    quota_type text NOT NULL,
    threshold integer NOT NULL,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT quota_alerts_pkey PRIMARY KEY (month, quota_type, threshold),
    CONSTRAINT quota_alerts_quota_type_check CHECK ((quota_type = ANY (ARRAY['calls'::text, 'budget'::text]))),
    CONSTRAINT quota_alerts_threshold_check CHECK ((threshold = ANY (ARRAY[80, 100])))
);

-- ai_models starts empty: the administrator lists the models their provider
-- offers (and, optionally, what they pay for them) in the instance area.
