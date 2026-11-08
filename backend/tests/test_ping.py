import asyncio

import server


def test_ping_returns_ok_without_database_access():
    route = next(r for r in server.api.routes if getattr(r, "path", None) == "/api/ping")
    assert route.methods == {"GET"}
    assert asyncio.run(route.endpoint()) == {"status": "ok", "message": "Server is active"}
