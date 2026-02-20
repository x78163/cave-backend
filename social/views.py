"""Social views — ratings, follows, activity feed, expeditions, posts."""

from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from caves.models import Cave
from .models import (
    CaveRating, UserFollow, Activity, Expedition, ExpeditionMember,
    Post, PostReaction, PostComment,
)
from .serializers import (
    CaveRatingSerializer, UserFollowSerializer, ActivitySerializer,
    ExpeditionSerializer, ExpeditionMemberSerializer,
    PostSerializer, PostCommentSerializer, PostReactionSerializer,
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

    # POST — requires auth (default IsAuthenticatedOrReadOnly)
    data = request.data.copy()
    data['cave'] = cave.id
    data['user'] = request.user.id
    serializer = CaveRatingSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
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
@permission_classes([IsAuthenticated])
def user_follow(request, user_id):
    """Follow (POST) or unfollow (DELETE) a user. Uses request.user as follower."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    target = get_object_or_404(User, pk=user_id)

    if request.user.id == target.id:
        return Response(
            {'detail': 'Users cannot follow themselves.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.method == 'POST':
        follow, created = UserFollow.objects.get_or_create(
            follower=request.user, following=target
        )
        if not created:
            return Response(
                {'detail': 'Already following this user.'},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = UserFollowSerializer(follow)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # DELETE
    deleted, _ = UserFollow.objects.filter(
        follower=request.user, following=target
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

    # POST — requires auth
    serializer = ExpeditionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(organizer=request.user)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
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


# ── Posts ────────────────────────────────────────────────────


@api_view(['GET', 'POST'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def post_list(request):
    """
    GET  — Social feed.
      Authenticated: own + followed users' posts (feed)
      ?user=<id>    → single user's wall
      ?grotto=<id>  → group wall
      Unauthenticated: all public posts
    POST — Create a post (supports FormData for image upload). Requires auth.
    """
    if request.method == 'GET':
        user_id = request.query_params.get('user')
        grotto_id = request.query_params.get('grotto')

        posts = Post.objects.select_related('author', 'cave', 'grotto')

        # Determine current user for feed + reaction context
        current_user_id = None
        if request.user and request.user.is_authenticated:
            current_user_id = request.user.id

        cave_id = request.query_params.get('cave')

        if cave_id:
            posts = posts.filter(cave_id=cave_id, is_deleted=False)
        elif grotto_id:
            posts = posts.filter(grotto_id=grotto_id, is_deleted=False)
        elif user_id:
            # User wall: show soft-deleted posts (as "[Deleted by author]")
            posts = posts.filter(author_id=user_id)
        elif current_user_id:
            following_ids = list(
                UserFollow.objects.filter(follower_id=current_user_id)
                .values_list('following_id', flat=True)
            )
            posts = posts.filter(
                Q(author_id=current_user_id) | Q(author_id__in=following_ids)
            ).filter(
                Q(visibility='public') | Q(visibility='followers') | Q(author_id=current_user_id)
            ).filter(is_deleted=False)
        else:
            posts = posts.filter(visibility='public', is_deleted=False)

        total = posts.count()
        limit = int(request.query_params.get('limit', 20))
        offset = int(request.query_params.get('offset', 0))
        page = posts[offset:offset + limit]

        serializer = PostSerializer(
            page, many=True,
            context={'current_user': current_user_id},
        )
        return Response({
            'total': total,
            'limit': limit,
            'offset': offset,
            'results': serializer.data,
        })

    # POST — requires auth
    data = request.data.copy()
    data['author'] = request.user.id
    serializer = PostSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    post = serializer.save()
    # Cache cave name for persistence after cave deletion
    if post.cave:
        post.cave_name_cache = post.cave.name
        post.save(update_fields=['cave_name_cache'])
    return Response(
        PostSerializer(post, context={'current_user': request.user.id}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'DELETE'])
def post_detail(request, post_id):
    """Get or delete a single post."""
    post = get_object_or_404(Post, pk=post_id)

    if request.method == 'DELETE':
        if not request.user.is_authenticated:
            return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
        if request.user.id != post.author_id and not request.user.is_staff:
            return Response({'error': 'Only the author can delete this post'}, status=status.HTTP_403_FORBIDDEN)

        if post.comments.exists():
            # Soft delete — preserve for comment context
            from django.utils import timezone
            post.is_deleted = True
            post.deleted_at = timezone.now()
            post.save(update_fields=['is_deleted', 'deleted_at'])
            return Response({'detail': 'Post marked as deleted'}, status=status.HTTP_200_OK)
        else:
            # Hard delete — no comments to preserve
            post.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

    current_user_id = None
    if request.user and request.user.is_authenticated:
        current_user_id = request.user.id
    serializer = PostSerializer(post, context={'current_user': current_user_id})
    return Response(serializer.data)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def post_react(request, post_id):
    """
    POST — Add or switch reaction. Body: {reaction_type}.
    DELETE — Remove reaction.
    Uses request.user.
    """
    post = get_object_or_404(Post, pk=post_id)

    if request.method == 'DELETE':
        deleted, _ = PostReaction.objects.filter(
            post=post, user=request.user
        ).delete()
        if not deleted:
            return Response(
                {'detail': 'No reaction found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # POST — upsert
    reaction_type = request.data.get('reaction_type')
    if reaction_type not in ('like', 'dislike'):
        return Response(
            {'detail': 'reaction_type must be "like" or "dislike".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    reaction, created = PostReaction.objects.update_or_create(
        post=post, user=request.user,
        defaults={'reaction_type': reaction_type},
    )
    serializer = PostReactionSerializer(reaction)
    resp_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return Response(serializer.data, status=resp_status)


@api_view(['GET', 'POST'])
def post_comments(request, post_id):
    """List or add comments on a post."""
    post = get_object_or_404(Post, pk=post_id)

    if request.method == 'GET':
        comments = PostComment.objects.filter(post=post).select_related('author')
        serializer = PostCommentSerializer(comments, many=True)
        return Response(serializer.data)

    # POST — requires auth
    if post.is_deleted:
        return Response(
            {'error': 'Cannot comment on a deleted post'},
            status=status.HTTP_403_FORBIDDEN,
        )
    data = request.data.copy()
    data['post'] = post.id
    data['author'] = request.user.id
    serializer = PostCommentSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def post_comment_delete(request, post_id, comment_id):
    """Delete a comment."""
    comment = get_object_or_404(PostComment, pk=comment_id, post_id=post_id)
    comment.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
