from django.contrib.auth.models import User
from rest_framework import serializers
from .models import UserProfile, Grotto, GrottoMembership


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']
        read_only_fields = ['id']


class UserProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = UserProfile
        fields = [
            'id', 'user', 'bio', 'avatar', 'location',
            'caves_explored', 'total_mapping_distance',
            'expeditions_count', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'caves_explored', 'total_mapping_distance', 'expeditions_count',
        ]


class GrottoSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(source='memberships.count', read_only=True)

    class Meta:
        model = Grotto
        fields = [
            'id', 'name', 'description', 'website', 'logo',
            'created_by', 'member_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class GrottoMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = GrottoMembership
        fields = ['id', 'user', 'grotto', 'role', 'joined_at']
        read_only_fields = ['id', 'joined_at']
