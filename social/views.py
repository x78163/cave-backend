"""Social views — ratings, follows, activity feed, expeditions."""

from django.db.models import Avg, Count
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from caves.models import Cave
from .models import CaveRating, UserFollow, Activity, Expedition, ExpeditionMember
from .serializers import (
    CaveRatingSerializer, UserFollowSerializer, ActivitySerializer,
    ExpeditionSerializer, ExpeditionMemberSerializer,
)


# ── Cave Ratings ──────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def user_ratings(request, user_id):
    """List all ratings by a user across all caves."""
    ratings = (
        CaveRating.objects.filter(user_id=user_id)
        .select_related('cave')
    )

    total = ratings.count()
    limit = int(request.query_params.get('limit', 50))
    offset = int(request.query_params.get('offset', 0))
    ratings = ratings[offset:offset + limit]

    serializer = CaveRatingSerializer(ratings, many=True)
    return Response({
        'total': total,
        'limit': limit,
        'offset': offset,
        'results': serializer.data,
    })


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def cave_ratings(request, cave_id):
    """List ratings (with avg + count) or create a rating for a cave."""
    cave = get_object_or_404(Cave, pk=cave_id)

    if request.method == 'GET':
        ratings = CaveRating.objects.filter(cave=cave)
        agg = ratings.aggregate(
            average=Avg('rating'), count=Count('id')
        )
        serializer = CaveRatingSerializer(ratings, many=True)
        return Response({
            'average_rating': agg['average'],
            'rating_count': agg['count'],
            'ratings': serializer.data,
        })

    # POST
    data = request.data.copy()
    data['cave'] = cave.id
    serializer = CaveRatingSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([AllowAny])
def cave_rating_detail(request, cave_id, rating_id):
    """Update or delete a specific rating."""
    rating = get_object_or_404(CaveRating, pk=rating_id, cave_id=cave_id)

    if request.method == 'DELETE':
        rating.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH
    serializer = CaveRatingSerializer(rating, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


# ── User Follows ──────────────────────────────────────────────


@api_view(['POST', 'DELETE'])
@permission_classes([AllowAny])
def user_follow(request, user_id):
    """Follow (POST) or unfollow (DELETE) a user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    target = get_object_or_404(User, pk=user_id)

    if request.method == 'POST':
        follower_id = request.data.get('follower')
        if str(follower_id) == str(user_id):
            return Response(
                {'detail': 'Users cannot follow themselves.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        follow, created = UserFollow.objects.get_or_create(
            follower_id=follower_id, following=target
        )
        if not created:
            return Response(
                {'detail': 'Already following this user.'},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = UserFollowSerializer(follow)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # DELETE
    follower_id = request.data.get('follower')
    deleted, _ = UserFollow.objects.filter(
        follower_id=follower_id, following=target
    ).delete()
    if not deleted:
        return Response(
            {'detail': 'Not following this user.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([AllowAny])
def user_followers(request, user_id):
    """List users who follow the given user."""
    follows = UserFollow.objects.filter(following_id=user_id)
    serializer = UserFollowSerializer(follows, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def user_following(request, user_id):
    """List users the given user is following."""
    follows = UserFollow.objects.filter(follower_id=user_id)
    serializer = UserFollowSerializer(follows, many=True)
    return Response(serializer.data)


# ── Activity Feed ─────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def activity_feed(request):
    """Global activity feed, optionally filtered by ?user= or ?cave=."""
    activities = Activity.objects.all()

    user_id = request.query_params.get('user')
    if user_id:
        activities = activities.filter(actor_id=user_id)

    cave_id = request.query_params.get('cave')
    if cave_id:
        activities = activities.filter(cave_id=cave_id)

    # Simple pagination
    limit = int(request.query_params.get('limit', 50))
    offset = int(request.query_params.get('offset', 0))
    total = activities.count()
    activities = activities[offset:offset + limit]

    serializer = ActivitySerializer(activities, many=True)
    return Response({
        'total': total,
        'limit': limit,
        'offset': offset,
        'results': serializer.data,
    })


# ── Expeditions ───────────────────────────────────────────────


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def expedition_list(request):
    """List expeditions (filter by ?cave=, ?status=) or create one."""
    if request.method == 'GET':
        expeditions = Expedition.objects.all()

        cave_id = request.query_params.get('cave')
        if cave_id:
            expeditions = expeditions.filter(cave_id=cave_id)

        exp_status = request.query_params.get('status')
        if exp_status:
            expeditions = expeditions.filter(status=exp_status)

        serializer = ExpeditionSerializer(expeditions, many=True)
        return Response(serializer.data)

    # POST
    serializer = ExpeditionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([AllowAny])
def expedition_detail(request, expedition_id):
    """Retrieve, update, or delete an expedition."""
    expedition = get_object_or_404(Expedition, pk=expedition_id)

    if request.method == 'GET':
        serializer = ExpeditionSerializer(expedition)
        return Response(serializer.data)

    if request.method == 'DELETE':
        expedition.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH
    serializer = ExpeditionSerializer(
        expedition, data=request.data, partial=True
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def expedition_members(request, expedition_id):
    """List or invite members for an expedition."""
    expedition = get_object_or_404(Expedition, pk=expedition_id)

    if request.method == 'GET':
        members = ExpeditionMember.objects.filter(expedition=expedition)
        serializer = ExpeditionMemberSerializer(members, many=True)
        return Response(serializer.data)

    # POST — invite a member
    data = request.data.copy()
    data['expedition'] = expedition.id
    serializer = ExpeditionMemberSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([AllowAny])
def expedition_member_respond(request, expedition_id, member_id):
    """Confirm or decline expedition membership."""
    member = get_object_or_404(
        ExpeditionMember, pk=member_id, expedition_id=expedition_id
    )
    new_status = request.data.get('status')
    if new_status not in ('confirmed', 'declined'):
        return Response(
            {'detail': 'Status must be "confirmed" or "declined".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    member.status = new_status
    member.save(update_fields=['status'])
    serializer = ExpeditionMemberSerializer(member)
    return Response(serializer.data)
