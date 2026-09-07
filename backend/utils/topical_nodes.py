"""Stable identities and conflict detection for persisted topical plans."""
from copy import deepcopy
from hashlib import sha256
import json


def fingerprint(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def identified_maps(maps):
    maps = deepcopy(maps or [])
    for m in maps:
        for i, node in enumerate(m.get("content_articles") or []):
            if not node.get("node_id"):
                stable = {k: v for k, v in node.items() if k != "brief"}
                node["node_id"] = fingerprint([m.get("url"), i, stable])
    return maps


def merge_brief(maps, node_id, brief, previous_brief):
    """Merge into the latest plan; never revive a removed node or overwrite a newer brief."""
    maps = identified_maps(maps)
    for node in (maps[0].get("content_articles") or []) if maps else []:
        if node["node_id"] == node_id:
            if node.get("brief") != previous_brief:
                raise ValueError("This brief changed. Reload the map before trying again.")
            node["brief"] = brief
            return maps
    raise ValueError("The node list changed. Reload the map before trying again.")


def replace_nodes(maps, expected, articles, bridges, snapshot):
    maps = identified_maps(maps)
    if not maps or fingerprint(maps[0]) != expected:
        raise ValueError("The map changed while regenerating. Reload it before trying again.")
    maps[0].update(content_articles=articles, bridge_topics=bridges, grounding_snapshot=snapshot)
    return maps


def brief_grounding(primary, node):
    evidence = deepcopy(primary.get("grounding_snapshot") or {})
    label = (node.get("cluster_label") or "").strip().lower()
    evidence["keyword_clusters"] = [c for c in primary.get("keyword_clusters") or []
                                    if label and (c.get("label") or "").strip().lower() == label]
    return evidence
