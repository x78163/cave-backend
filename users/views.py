"""
Views for users app — profiles and grottos.
"""

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import UserProfile, Grotto, GrottoMembership
from .serializers import (
    UserProfileSerializer, GrottoSerializer, GrottoMembershipSerializer,
)


@api_view(['GET'])
def user_profile(request):
    """Get the current user's profile (placeholder until auth is added)."""
    return Response({
        'message': 'Auth not yet implemented. Use /api/users/profile/<user_id>/',
    })


@api_view(['GET', 'PATCH'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def user_profile_detail(request, user_id):
    """Get or update a user profile."""
    try:
        profile = UserProfile.objects.get(user_id=user_id)
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
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
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
