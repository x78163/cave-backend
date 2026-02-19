"""
Views for users app — auth, profiles, and grottos.
"""

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserProfile, Grotto, GrottoMembership
from .serializers import (
    RegisterSerializer, UserProfileSerializer,
    GrottoSerializer, GrottoMembershipSerializer,
)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    """Register a new user and return JWT tokens."""
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserProfileSerializer(user).data,
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
    }, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def me_view(request):
    """Get or update the currently authenticated user's profile."""
    if request.method == 'GET':
        return Response(UserProfileSerializer(request.user).data)

    serializer = UserProfileSerializer(request.user, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET', 'PATCH'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def user_profile_detail(request, user_id):
    """Get or update a user profile by ID."""
    try:
        profile = UserProfile.objects.get(pk=user_id)
    except UserProfile.DoesNotExist:
        return Response({'error': 'Profile not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = UserProfileSerializer(profile)
        return Response(serializer.data)

    elif request.method == 'PATCH':
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def grotto_list(request):
    """List all grottos or create a new one."""
    if request.method == 'GET':
        grottos = Grotto.objects.all()
        serializer = GrottoSerializer(grottos, many=True)
        return Response({'grottos': serializer.data, 'count': grottos.count()})

    elif request.method == 'POST':
        serializer = GrottoSerializer(data=request.data)
        if serializer.is_valid():
            grotto = serializer.save(created_by=request.user)
            GrottoMembership.objects.create(
                user=request.user, grotto=grotto,
                role='admin', status='active',
            )
            return Response(GrottoSerializer(grotto).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def grotto_detail(request, grotto_id):
    """Get, update, or delete a grotto."""
    try:
        grotto = Grotto.objects.get(id=grotto_id)
    except Grotto.DoesNotExist:
        return Response({'error': 'Grotto not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = GrottoSerializer(grotto)
        return Response(serializer.data)

    elif request.method == 'PATCH':
        serializer = GrottoSerializer(grotto, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        grotto.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
def grotto_members(request, grotto_id):
    """List or add members to a grotto."""
    try:
        grotto = Grotto.objects.get(id=grotto_id)
    except Grotto.DoesNotExist:
        return Response({'error': 'Grotto not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        memberships = grotto.memberships.all()
        serializer = GrottoMembershipSerializer(memberships, many=True)
        return Response({'members': serializer.data, 'count': memberships.count()})

    elif request.method == 'POST':
        serializer = GrottoMembershipSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(grotto=grotto)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def grotto_apply(request, grotto_id):
    """Apply to join a grotto. Uses request.user."""
    grotto = Grotto.objects.filter(id=grotto_id).first()
    if not grotto:
        return Response({'error': 'Grotto not found'}, status=status.HTTP_404_NOT_FOUND)
    membership, created = GrottoMembership.objects.get_or_create(
        grotto=grotto, user=request.user,
        defaults={'status': 'pending_application', 'role': 'member'},
    )
    if not created:
        return Response(
            {'detail': 'Already a member or pending.'},
            status=status.HTTP_409_CONFLICT,
        )
    serializer = GrottoMembershipSerializer(membership)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def grotto_invite(request, grotto_id):
    """Invite a user to a grotto. Body: {user}."""
    grotto = Grotto.objects.filter(id=grotto_id).first()
    if not grotto:
        return Response({'error': 'Grotto not found'}, status=status.HTTP_404_NOT_FOUND)
    user_id = request.data.get('user')
    user = UserProfile.objects.filter(pk=user_id).first()
    if not user:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    membership, created = GrottoMembership.objects.get_or_create(
        grotto=grotto, user=user,
        defaults={'status': 'pending_invitation', 'role': 'member'},
    )
    if not created:
        return Response(
            {'detail': 'Already a member or pending.'},
            status=status.HTTP_409_CONFLICT,
        )
    serializer = GrottoMembershipSerializer(membership)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def grotto_member_update(request, grotto_id, membership_id):
    """Approve or reject a membership. Body: {status: 'active'|'rejected'}."""
    membership = GrottoMembership.objects.filter(
        pk=membership_id, grotto_id=grotto_id
    ).first()
    if not membership:
        return Response({'error': 'Membership not found'}, status=status.HTTP_404_NOT_FOUND)
    new_status = request.data.get('status')
    if new_status not in ('active', 'rejected'):
        return Response(
            {'detail': 'Status must be "active" or "rejected".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    membership.status = new_status
    membership.save(update_fields=['status'])
    serializer = GrottoMembershipSerializer(membership)
    return Response(serializer.data)
