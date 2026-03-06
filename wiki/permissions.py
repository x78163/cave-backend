"""Tiered wiki editing permissions.

- Anyone authenticated: can read published articles
- Trusted Editor (is_wiki_editor): can create/publish/edit directly
- Admin (is_staff): all permissions + lock/archive/delete, manage categories
"""

from rest_framework.permissions import BasePermission


class CanCreateArticle(BasePermission):
    """Editors and admins can create articles."""

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and (request.user.is_wiki_editor or request.user.is_staff)
        )


class CanEditArticle(BasePermission):
    """Editors and admins can publish edits directly.
    Regular users can suggest edits (handled in view logic)."""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


class CanDeleteArticle(BasePermission):
    """Only admins can archive/delete articles."""

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.is_staff
        )


class CanManageCategories(BasePermission):
    """Only admins can create/edit/delete categories."""

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.is_staff
        )
