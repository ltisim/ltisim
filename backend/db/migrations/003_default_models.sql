-- Default conversation and grading models, chosen by the administrator in
-- the instance area. NULL falls back to AI_MODEL / AI_GRADING_MODEL.
ALTER TABLE public.instance_settings
    ADD COLUMN default_model text,
    ADD COLUMN default_grading_model text;
