"""Endpoint /v1/me — perfil del usuario autenticado.

Stub — completar cuando se conecte Clerk middleware.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def me() -> dict[str, str]:
    return {"message": "stub — implementar tras integrar Clerk middleware"}
