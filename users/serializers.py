from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import UserProfile, Grotto, GrottoMembership


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)

    def validate_username(self, value):
        if ' ' in value:
            raise serializers.ValidationError('Username cannot contain spaces.')
        if UserProfile.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('Username already taken.')
        return value

    def validate_email(self, value):
        if UserProfile.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value

    def validate(self, data):
        if data['password'] != data['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Passwords do not match.'})
        try:
            validate_password(data['password'])
        except DjangoValidationError as e:
            raise serializers.ValidationError({'password': e.messages})
        return data

    def create(self, validated_data):
        validated_data.pop('password_confirm')
        return UserProfile.objects.create_user(**validated_data)


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'bio', 'avatar', 'avatar_preset', 'location',
            'specialties', 'onboarding_complete',
            'caves_explored', 'total_mapping_distance', 'expeditions_count',
            'date_joined', 'updated_at',
        ]
        read_only_fields = [
            'id', 'username', 'email', 'date_joined', 'updated_at',
            'caves_explored', 'total_mapping_distance', 'expeditions_count',
        ]

    def validate_specialties(self, value):
        import json
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise serializers.ValidationError('Invalid JSON for specialties.')
        if not isinstance(value, list):
            raise serializers.ValidationError('Specialties must be a list.')
        if len(value) > 10:
            raise serializers.ValidationError('Maximum 10 specialties allowed.')
        for item in value:
            if not isinstance(item, str) or len(item) > 50:
                raise serializers.ValidationError('Each specialty must be a string of 50 chars or less.')
        return value


class GrottoSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(source='memberships.count', read_only=True)

    class Meta:
        model = Grotto
        fields = [
            'id', 'name', 'description', 'website', 'logo',
            'cover_image', 'privacy', 'created_by', 'member_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class GrottoMembershipSerializer(serializers.ModelSerializer):
    user = UserProfileSerializer(read_only=True)

    class Meta:
        model = GrottoMembership
        fields = ['id', 'user', 'grotto', 'role', 'status', 'joined_at']
        read_only_fields = ['id', 'joined_at']
