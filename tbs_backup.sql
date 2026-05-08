--
-- PostgreSQL database dump
--

\restrict 6t7BNtRsr1cJbBQwP6PwbDWsjZeLa2KAxQ5QzgsEeo1MvHG9aZUEN9ox8Zp1H4z

-- Dumped from database version 15.15 (Homebrew)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP INDEX public.ix_users_email;
DROP INDEX public.ix_documents_user_email;
DROP INDEX public.ix_documents_id;
DROP INDEX public.ix_documents_analysis_id;
DROP INDEX public.ix_analyses_user_email;
DROP INDEX public.ix_analyses_analysis_id;
ALTER TABLE ONLY public.users DROP CONSTRAINT users_pkey;
ALTER TABLE ONLY public.documents DROP CONSTRAINT documents_pkey;
ALTER TABLE ONLY public.analyses DROP CONSTRAINT analyses_pkey;
DROP TABLE public.users;
DROP TABLE public.documents;
DROP TABLE public.analyses;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analyses; Type: TABLE; Schema: public; Owner: tbs_user
--

CREATE TABLE public.analyses (
    analysis_id character varying NOT NULL,
    user_email character varying NOT NULL,
    urls json NOT NULL,
    created_at timestamp without time zone NOT NULL,
    status character varying NOT NULL,
    scraped_data json,
    knowledge_graph json,
    topical_maps json,
    comparison json,
    error text,
    label character varying
);


ALTER TABLE public.analyses OWNER TO tbs_user;

--
-- Name: documents; Type: TABLE; Schema: public; Owner: tbs_user
--

CREATE TABLE public.documents (
    id character varying NOT NULL,
    user_email character varying NOT NULL,
    analysis_id character varying,
    title character varying NOT NULL,
    content_type character varying NOT NULL,
    content json NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    folder character varying,
    deadline timestamp without time zone
);


ALTER TABLE public.documents OWNER TO tbs_user;

--
-- Name: users; Type: TABLE; Schema: public; Owner: tbs_user
--

CREATE TABLE public.users (
    email character varying NOT NULL,
    name character varying,
    picture character varying,
    gsc_token text,
    gsc_connected_at timestamp without time zone,
    created_at timestamp without time zone NOT NULL,
    last_login timestamp without time zone NOT NULL,
    gsc_token_is_refresh boolean DEFAULT false NOT NULL
);


ALTER TABLE public.users OWNER TO tbs_user;

--
-- Data for Name: analyses; Type: TABLE DATA; Schema: public; Owner: tbs_user
--

--
-- Name: analyses analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: tbs_user
--

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_pkey PRIMARY KEY (analysis_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: tbs_user
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: tbs_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (email);


--
-- Name: ix_analyses_analysis_id; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_analyses_analysis_id ON public.analyses USING btree (analysis_id);


--
-- Name: ix_analyses_user_email; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_analyses_user_email ON public.analyses USING btree (user_email);


--
-- Name: ix_documents_analysis_id; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_documents_analysis_id ON public.documents USING btree (analysis_id);


--
-- Name: ix_documents_id; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_documents_id ON public.documents USING btree (id);


--
-- Name: ix_documents_user_email; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_documents_user_email ON public.documents USING btree (user_email);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: tbs_user
--

CREATE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO tbs_user;


--
-- PostgreSQL database dump complete
--

\unrestrict 6t7BNtRsr1cJbBQwP6PwbDWsjZeLa2KAxQ5QzgsEeo1MvHG9aZUEN9ox8Zp1H4z

