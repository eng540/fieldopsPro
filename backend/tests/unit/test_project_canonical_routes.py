from app.modules.projects import router


def _paths(routes):
    for route in routes:
        path = getattr(route, "path", None)
        if path:
            yield path
        nested = getattr(route, "routes", None)
        if nested:
            yield from _paths(nested)


def test_canonical_boq_routes_are_mounted_on_projects_router():
    paths = set(_paths(router.routes))
    assert "/{project_id}/canonical-boq" in paths
    assert "/{project_id}/canonical-boq/{boq_item_id}/apply" in paths
    assert "/{project_id}/canonical-boq/{boq_item_id}/unapply" in paths
