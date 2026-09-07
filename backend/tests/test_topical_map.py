"""Topical-map regressions. AI/SERP calls are mocked; database tests use temporary SQLite.

Run with test-only settings, e.g. GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test
SECRET_KEY=test DATABASE_URL=sqlite:////tmp/tbs-tests.db PYTHON_DOTENV_DISABLED=1 pytest.
"""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Analysis, Document
from models.schemas import BriefRequest, ContentArticle, UserInfo
from services.topical_map import TopicalMapGenerator, ai_service
from services import brief_generator
from api.routers import analysis as routes, content
from utils.storage import database_store
from utils.topical_nodes import identified_maps, merge_brief

USER = UserInfo(email='test@example.com', name='Test')

def article(title='Capacity planning', **extra):
    return ContentArticle(title=title, section='Core', article_type='informative',
                          category_l1='Planning', priority=1, source_context='Sell planning software', **extra)

def maps():
    return [{'url': 'https://example.com', 'business_model': 'SaaS',
             'source_context': 'Sell planning software', 'central_entity': 'Resource planning',
             'central_search_intent': 'Plan team capacity', 'market': {'gl': 'us', 'location_id': 2840},
             'content_articles': [article('A').model_dump(), article('B').model_dump()],
             'grounding_snapshot': {'own_paths': ['/planning'], 'real_q': ['how to plan capacity']}}]

@pytest.fixture
def sessions(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "test.db"}')
    Analysis.__table__.create(engine)
    Document.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(Analysis(analysis_id='test', user_email=USER.email, urls=['https://example.com'],
                        status='completed', topical_maps=maps()))
        db.commit()
    yield factory
    engine.dispose()

@pytest.mark.parametrize('failure', ['scrape', 'ai'])
def test_primary_failure_never_promotes_competitor(failure):
    generator = TopicalMapGenerator()
    async def generate(d, **kwargs):
        if d['url'] == 'primary':
            raise ValueError('AI failed')
        return SimpleNamespace(url=d['url'], key_topics=[], content_strategy=None)
    generator.generate_topical_map_with_ai = generate
    with pytest.raises(ValueError, match='Primary'):
        asyncio.run(generator.generate_multiple([
            {'url': 'primary', 'status': 'failed' if failure == 'scrape' else 'success'},
            {'url': 'competitor', 'status': 'success'}]))


def test_legacy_ids_survive_brief_changes_without_mutating_input():
    raw = [{'url': 'site', 'content_articles': [{'title': 'A'}]}]
    first = identified_maps(raw)
    first[0]['content_articles'][0]['brief'] = 'Saved'
    assert identified_maps(first)[0]['content_articles'][0]['node_id'] == identified_maps(raw)[0]['content_articles'][0]['node_id']
    assert 'node_id' not in raw[0]['content_articles'][0]


def test_concurrent_briefs_both_survive(sessions, monkeypatch):
    async def run():
        ready = asyncio.Event()
        calls = 0
        async def generate(**kw):
            nonlocal calls
            calls += 1
            if calls == 2:
                ready.set()
            await ready.wait()
            return 'Brief ' + kw['node']['title']
        monkeypatch.setattr(routes.topical_generator, 'generate_node_brief', generate)
        with sessions() as one, sessions() as two:
            await asyncio.gather(routes.generate_node_brief('test', 0, {}, USER, one),
                                 routes.generate_node_brief('test', 1, {}, USER, two))
    asyncio.run(run())
    with sessions() as db:
        saved = database_store.get_analysis(db, 'test')['topical_maps'][0]['content_articles']
        assert [n['brief'] for n in saved] == ['Brief A', 'Brief B']


def test_brief_cannot_restore_old_nodes(sessions, monkeypatch):
    async def generate(**kw):
        with sessions() as other:
            database_store.mutate_topical_maps(other, 'test', USER.email, lambda _: maps())
        return 'Old node brief'
    monkeypatch.setattr(routes.topical_generator, 'generate_node_brief', generate)
    with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.generate_node_brief('test', 0, {}, USER, db))
        assert exc.value.status_code == 409
        assert not database_store.get_analysis(db, 'test')['topical_maps'][0]['content_articles'][0].get('brief')


def test_stale_client_node_is_rejected(sessions):
    with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.generate_node_brief('test', 0, {'node_id': 'old'}, USER, db))
        assert exc.value.status_code == 409


def test_regeneration_retains_market_and_source(sessions, monkeypatch):
    generate = AsyncMock(return_value=([article('New')], []))
    monkeypatch.setattr(routes.topical_generator, 'generate_content_nodes', generate)
    with sessions() as db:
        result = asyncio.run(routes.regenerate_topical_nodes('test', {}, USER, db))
        assert result['content_articles'][0]['title'] == 'New'
        assert generate.call_args.kwargs['market']['gl'] == 'us'
        assert generate.call_args.kwargs['source_context'] == 'Sell planning software'
        assert generate.call_args.kwargs['central_search_intent'] == 'Plan team capacity'


def test_empty_regeneration_keeps_plan(sessions, monkeypatch):
    monkeypatch.setattr(routes.topical_generator, 'generate_content_nodes', AsyncMock(return_value=([], [])))
    with sessions() as db:
        before = deepcopy(database_store.get_analysis(db, 'test')['topical_maps'])
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.regenerate_topical_nodes('test', {}, USER, db))
        assert exc.value.status_code == 502
        assert database_store.get_analysis(db, 'test')['topical_maps'] == before


def test_regeneration_cannot_erase_new_brief(sessions, monkeypatch):
    async def generate(**kw):
        with sessions() as other:
            current = identified_maps(database_store.get_analysis(other, 'test')['topical_maps'])
            node_id = current[0]['content_articles'][0]['node_id']
            database_store.mutate_topical_maps(other, 'test', USER.email,
                lambda latest: merge_brief(latest, node_id, 'New brief', None))
        return [article('New')], []
    monkeypatch.setattr(routes.topical_generator, 'generate_content_nodes', generate)
    with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.regenerate_topical_nodes('test', {}, USER, db))
        assert exc.value.status_code == 409
        assert database_store.get_analysis(db, 'test')['topical_maps'][0]['content_articles'][0]['brief'] == 'New brief'


def test_writing_uses_saved_brief_and_real_title(sessions, monkeypatch):
    with sessions() as db:
        current = database_store.get_analysis(db, 'test')['topical_maps']
        node_id = current[0]['content_articles'][0]['node_id']
        database_store.mutate_topical_maps(db, 'test', USER.email, lambda latest: merge_brief(latest, node_id, 'Grounded outline', None))
    generic = AsyncMock(side_effect=AssertionError('Must not create a generic brief'))
    writer = AsyncMock(return_value='# Article')
    monkeypatch.setattr(brief_generator, 'generate_content_brief', generic)
    monkeypatch.setattr(brief_generator, 'generate_full_article', writer)
    with sessions() as db:
        result = asyncio.run(content.create_full_article_direct('test', BriefRequest(
            node_id=node_id, topic='Stale title', category='Test', article_type='informative'), USER, db))
        assert result['document_id']
        assert writer.call_args.kwargs['topic'] == 'A'
        assert writer.call_args.kwargs['brief_data']['node_brief'] == 'Grounded outline'
        assert writer.call_args.kwargs['brief_data']['source_context'] == 'Sell planning software'
        generic.assert_not_called()


def test_article_prompt_contains_saved_brief_and_method(monkeypatch):
    generate = AsyncMock(return_value='# Written')
    monkeypatch.setattr(ai_service, 'analyze_with_ai', generate)
    asyncio.run(brief_generator.generate_full_article('A', {'node_brief': 'Unique outline ABC', 'source_context': 'Sell software'}))
    prompt = generate.call_args.args[0]
    assert 'Unique outline ABC' in prompt and 'Sell software' in prompt
    assert 'TBS BRIEF AND WRITING METHOD' in prompt


def test_node_brief_receives_foundations_and_research(monkeypatch):
    generate = AsyncMock(return_value='## Outline')
    monkeypatch.setattr(ai_service, 'analyze_with_ai', generate)
    asyncio.run(TopicalMapGenerator().generate_node_brief(domain='example.com', business_model='SaaS',
        node=article().model_dump(), source_context='Sell planning', central_search_intent='Plan capacity',
        market={'gl': 'us'}, grounding={'real_q': ['capacity question']}))
    prompt = generate.call_args.args[0]
    for text in ['Sell planning', 'Plan capacity', 'capacity question', '"gl": "us"', 'TBS BRIEF']:
        assert text in prompt


def test_bad_ai_rows_and_invented_metrics_do_not_pollute_plan(monkeypatch):
    generator = TopicalMapGenerator()
    payload = [article().model_dump(), {'title': 'Missing required data'}]
    payload[0].update(search_volume=99999, kd=10)
    monkeypatch.setattr(ai_service, 'extract_json', AsyncMock(return_value={'nodes': payload}))
    monkeypatch.setattr(generator, '_dedupe_nodes_by_serp', AsyncMock(side_effect=lambda nodes, *args: nodes))
    from services import mangools_service
    monkeypatch.setattr(mangools_service, 'mangools_configured', lambda: False)
    result, _ = asyncio.run(generator.generate_content_nodes(domain='example.com', business_model='SaaS',
        key_topics=[], core_topics=[], outer_topics=[], own_paths=[], source_context='Sell planning'))
    assert len(result) == 1
    assert result[0].search_volume is None and result[0].kd is None


def test_zero_cluster_volume_is_preserved(monkeypatch):
    generator = TopicalMapGenerator()
    monkeypatch.setattr(ai_service, 'extract_json', AsyncMock(return_value={'nodes': [article(cluster_label='capacity').model_dump()]}))
    monkeypatch.setattr(generator, '_dedupe_nodes_by_serp', AsyncMock(side_effect=lambda nodes, *args: nodes))
    from services import mangools_service
    monkeypatch.setattr(mangools_service, 'mangools_configured', lambda: False)
    result, _ = asyncio.run(generator.generate_content_nodes(domain='example.com', business_model='SaaS',
        key_topics=[], core_topics=[], outer_topics=[], own_paths=[], keyword_clusters=[{'label': 'capacity', 'total_volume': 0}]))
    assert result[0].search_volume == 0


def test_update_requires_observed_url(monkeypatch):
    generator = TopicalMapGenerator()
    monkeypatch.setattr(ai_service, 'extract_json', AsyncMock(return_value={'nodes': [article(page_action='update', existing_url='https://invented.com/no').model_dump()]}))
    with pytest.raises(ValueError, match='No valid'):
        asyncio.run(generator.generate_content_nodes(domain='example.com', business_model='SaaS',
            key_topics=[], core_topics=[], outer_topics=[], own_paths=['/real']))


def test_empty_scrape_results_fail_explicitly():
    with pytest.raises(ValueError, match='Primary'):
        asyncio.run(TopicalMapGenerator().generate_multiple([]))


def test_write_without_brief_creates_grounded_brief_and_caches_it(sessions, monkeypatch):
    node_brief = AsyncMock(return_value='Specific capacity outline')
    monkeypatch.setattr(routes.topical_generator, 'generate_node_brief', node_brief)
    writer = AsyncMock(return_value='# Draft')
    monkeypatch.setattr(brief_generator, 'generate_full_article', writer)
    with sessions() as db:
        current = database_store.get_analysis(db, 'test')['topical_maps']
        node_id = current[0]['content_articles'][0]['node_id']
        asyncio.run(content.create_full_article_direct('test', BriefRequest(
            node_id=node_id, topic='A', category='Planning', article_type='informative'), USER, db))
        assert node_brief.call_args.kwargs['source_context'] == 'Sell planning software'
        assert node_brief.call_args.kwargs['market']['gl'] == 'us'
        assert writer.call_args.kwargs['brief_data']['node_brief'] == 'Specific capacity outline'
        assert database_store.get_analysis(db, 'test')['topical_maps'][0]['content_articles'][0]['brief'] == 'Specific capacity outline'


def test_storage_rejects_other_owner(sessions):
    with sessions() as db:
        with pytest.raises(ValueError, match='no longer available'):
            database_store.mutate_topical_maps(db, 'test', 'someone-else@example.com', lambda _: [])
        assert len(database_store.get_analysis(db, 'test')['topical_maps']) == 1


def test_saved_brief_is_returned_without_ai(sessions, monkeypatch):
    generate = AsyncMock(side_effect=AssertionError('No AI for cached brief'))
    monkeypatch.setattr(routes.topical_generator, 'generate_node_brief', generate)
    with sessions() as db:
        current = database_store.get_analysis(db, 'test')['topical_maps']
        node_id = current[0]['content_articles'][0]['node_id']
        database_store.mutate_topical_maps(db, 'test', USER.email, lambda latest: merge_brief(latest, node_id, 'Saved', None))
        result = asyncio.run(routes.generate_node_brief('test', 0, {'node_id': node_id}, USER, db))
        assert result == {'brief': 'Saved', 'cached': True}
        generate.assert_not_called()


@pytest.mark.parametrize('nodes_fail', [False, True])
def test_full_generation_preserves_foundations_and_recovery_evidence(monkeypatch, nodes_fail):
    from services.sitemap_service import sitemap_service
    from services import topical_grounding
    generator = TopicalMapGenerator()
    monkeypatch.setattr(sitemap_service, 'get_priority_pages', AsyncMock(return_value=['https://example.com']))
    monkeypatch.setattr(topical_grounding, 'gather_grounding', AsyncMock(return_value={
        'serp': {'people_also_ask': ['How to plan capacity?']},
        'own_pages': [{'url': 'https://example.com/planning'}]}))
    extract = AsyncMock(return_value={'central_entity': 'Resource planning', 'source_context': 'Inferred offering',
                                     'central_search_intent': 'Plan capacity'})
    monkeypatch.setattr(ai_service, 'extract_json', extract)
    generate = AsyncMock(side_effect=ValueError('Malformed response')) if nodes_fail else AsyncMock(return_value=([article()], []))
    monkeypatch.setattr(generator, 'generate_content_nodes', generate)
    result = asyncio.run(generator.generate_topical_map_with_ai(
        {'url': 'https://example.com', 'headings': {}, 'links': [], 'text_content': 'Planning software'},
        market={'gl': 'gb'}, source_context='Actual customer offering'))
    assert result.source_context == 'Actual customer offering'
    assert result.central_search_intent == 'Plan capacity'
    assert result.market == {'gl': 'gb'}
    assert result.grounding_snapshot['real_q'] == ['How to plan capacity?']
    assert result.grounding_snapshot['source_context'] == 'Actual customer offering'
    assert 'TBS TOPICAL MAP METHOD' in extract.call_args.args[1]
    assert '{MAP_RULES}' not in extract.call_args.args[1]
    assert generate.call_args.kwargs['source_context'] == 'Actual customer offering'
    assert bool(result.content_articles) is not nodes_fail
