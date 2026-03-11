"""
Views for users app — auth, profiles, and grottos.
"""

import logging

import requests as http_requests
from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserProfile, Grotto, GrottoMembership, InviteCode, SiteSettings, NotificationPreference
from .serializers import (
    RegisterSerializer, UserProfileSerializer,
    GrottoSerializer, GrottoMembershipSerializer,
    InviteCodeSerializer, NotificationPreferenceSerializer,
)

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    """Register a new user and return JWT tokens."""
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()

    # Send verification email asynchronously via Celery
    from notifications.tasks import send_verification_email
    send_verification_email.delay(user.id)

    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserProfileSerializer(user).data,
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
        'email_verification_required': True,
    }, status=status.HTTP_201_CREATED)


# ── Google OAuth ───────────────────────────────────────────


GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'


def _exchange_google_code(code, redirect_uri):
    """Exchange an authorization code for Google user data."""
    google_client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '')
    google_client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '')

    # Exchange code for tokens
    token_resp = http_requests.post(GOOGLE_TOKEN_URL, data={
        'code': code,
        'client_id': google_client_id,
        'client_secret': google_client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }, timeout=10)

    if token_resp.status_code != 200:
        logger.warning('Google token exchange failed: %s', token_resp.text)
        return None

    tokens = token_resp.json()
    access_token = tokens.get('access_token')
    if not access_token:
        return None

    # Fetch user info with the access token
    userinfo_resp = http_requests.get(GOOGLE_USERINFO_URL, headers={
        'Authorization': f'Bearer {access_token}',
    }, timeout=5)

    if userinfo_resp.status_code != 200:
        return None

    return userinfo_resp.json()


@api_view(['POST'])
@permission_classes([AllowAny])
def google_auth_view(request):
    """Authenticate with Google OAuth.

    Accepts either:
    - {credential: <id_token>} — legacy GIS popup flow
    - {code: <auth_code>, redirect_uri: <uri>} — redirect flow
    """
    auth_code = request.data.get('code', '')
    redirect_uri = request.data.get('redirect_uri', '')
    credential = request.data.get('credential', '')

    if auth_code and redirect_uri:
        # Authorization code flow (redirect)
        google_data = _exchange_google_code(auth_code, redirect_uri)
        if not google_data:
            return Response({'error': 'Failed to exchange Google auth code'}, status=400)
    elif credential:
        # Legacy ID token flow (popup)
        try:
            resp = http_requests.get(
                GOOGLE_TOKENINFO_URL, params={'id_token': credential}, timeout=5,
            )
            if resp.status_code != 200:
                return Response({'error': 'Invalid Google token'}, status=400)
            google_data = resp.json()
        except http_requests.RequestException:
            return Response({'error': 'Failed to verify Google token'}, status=502)

        google_client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '')
        if google_client_id and google_data.get('aud') != google_client_id:
            return Response({'error': 'Token audience mismatch'}, status=400)
    else:
        return Response({'error': 'Missing Google credential or code'}, status=400)

    email = google_data.get('email', '')
    google_id = google_data.get('sub', '')
    if not email or not google_id:
        return Response({'error': 'Google token missing email or sub'}, status=400)

    if not google_data.get('email_verified'):
        return Response({'error': 'Google email not verified'}, status=400)

    # Try to find existing user by google_id or email
    user = UserProfile.objects.filter(google_id=google_id).first()
    if not user:
        user = UserProfile.objects.filter(email__iexact=email).first()
        if user:
            # Link existing account to Google
            user.google_id = google_id
            if not user.email_verified:
                user.email_verified = True
            user.save(update_fields=['google_id', 'email_verified'])

    if user:
        # Existing user — return tokens
        if not user.is_active:
            return Response({'error': 'Account is deactivated'}, status=403)
        refresh = RefreshToken.for_user(user)
        return Response({
            'user': UserProfileSerializer(user).data,
            'tokens': {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
            },
        })

    # New user — check invite code requirement
    site_settings = SiteSettings.load()
    invite_code_str = request.data.get('invite_code', '').strip().upper()

    if site_settings.require_invite_code:
        if not invite_code_str:
            return Response({
                'error': 'Invite code required',
                'needs_invite_code': True,
            }, status=403)
        try:
            invite = InviteCode.objects.get(code=invite_code_str)
        except InviteCode.DoesNotExist:
            return Response({'error': 'Invalid invite code'}, status=400)
        if not invite.is_usable:
            return Response({'error': 'Invite code has been used'}, status=400)
    else:
        invite = None

    # Create new user from Google data
    given_name = google_data.get('given_name', '')
    family_name = google_data.get('family_name', '')
    # Generate username from email prefix, ensure unique
    base_username = email.split('@')[0][:30]
    username = base_username
    counter = 1
    while UserProfile.objects.filter(username__iexact=username).exists():
        username = f'{base_username}{counter}'
        counter += 1

    user = UserProfile.objects.create_user(
        username=username,
        email=email,
        password=None,  # No password for OAuth users
        first_name=given_name,
        last_name=family_name,
        google_id=google_id,
        email_verified=True,  # Google already verified
        invited_by=invite.created_by if invite else None,
    )
    user.set_unusable_password()
    user.save()

    if invite:
        invite.use_count += 1
        invite.save(update_fields=['use_count'])

    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserProfileSerializer(user).data,
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
        'created': True,
    }, status=status.HTTP_201_CREATED)


# ── Email Verification ─────────────────────────────────────


def _make_verification_token(user):
    """Create a signed token for email verification (valid 3 days)."""
    return signing.dumps({'user_id': user.id, 'email': user.email}, salt='email-verify')


def _send_verification_email(user):
    """Send the verification email."""
    token = _make_verification_token(user)
    base_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    verify_url = f'{base_url}/verify-email?token={token}'

    subject = 'Verify your email — Cave Dragon'
    html_message = f'''
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #00d4ff;">Cave Dragon</h2>
        <p>Hi {user.username},</p>
        <p>Please verify your email address by clicking the button below:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{verify_url}"
               style="background: #00d4ff; color: #0a0a12; padding: 12px 32px;
                      text-decoration: none; border-radius: 4px; font-weight: bold;">
                Verify Email
            </a>
        </p>
        <p style="color: #888; font-size: 12px;">
            Or copy this link: {verify_url}
        </p>
        <p style="color: #888; font-size: 12px;">
            This link expires in 3 days.
        </p>
    </div>
    '''
    plain_message = (
        f'Hi {user.username},\n\n'
        f'Please verify your email by visiting:\n{verify_url}\n\n'
        f'This link expires in 3 days.\n'
    )

    send_mail(
        subject,
        plain_message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        html_message=html_message,
        fail_silently=False,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def send_verification_email_view(request):
    """Send (or resend) verification email. Body: {email}"""
    email = request.data.get('email', '').strip()
    if not email:
        return Response({'error': 'Email required'}, status=400)

    user = UserProfile.objects.filter(email__iexact=email).first()
    if not user:
        # Don't reveal whether email exists
        return Response({'status': 'sent'})

    if user.email_verified:
        return Response({'status': 'already_verified'})

    from notifications.tasks import send_verification_email
    send_verification_email.delay(user.id)
    return Response({'status': 'sent'})


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_email_view(request):
    """Verify email with signed token. Body: {token}"""
    token = request.data.get('token', '')
    if not token:
        return Response({'error': 'Token required'}, status=400)

    try:
        data = signing.loads(token, salt='email-verify', max_age=3 * 24 * 3600)
    except signing.BadSignature:
        return Response({'error': 'Invalid or expired token'}, status=400)

    user = UserProfile.objects.filter(id=data['user_id'], email=data['email']).first()
    if not user:
        return Response({'error': 'User not found'}, status=404)

    if not user.email_verified:
        user.email_verified = True
        user.save(update_fields=['email_verified'])

    # Return tokens so user is auto-logged in after verification
    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserProfileSerializer(user).data,
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
        'status': 'verified',
    })


# ── Custom Login (email verification check) ────────────────


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """Login with username/password, enforcing email verification."""
    from django.contrib.auth import authenticate

    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')

    if not username or not password:
        return Response({'error': 'Username and password required'}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response({'error': 'Invalid credentials'}, status=401)

    if not user.is_active:
        return Response({'error': 'Account is deactivated'}, status=403)

    if not user.email_verified:
        return Response({
            'error': 'Email not verified',
            'email_verification_required': True,
            'email': user.email,
        }, status=403)

    refresh = RefreshToken.for_user(user)
    return Response({
        'user': UserProfileSerializer(user).data,
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
    })


# ── Site Settings (admin) ──────────────────────────────────


@api_view(['GET', 'PATCH'])
@permission_classes([AllowAny])
def site_settings_view(request):
    """GET: public settings. PATCH: admin-only update."""
    site = SiteSettings.load()

    if request.method == 'GET':
        return Response({
            'require_invite_code': site.require_invite_code,
        })

    # PATCH — admin only
    if not request.user or not request.user.is_staff:
        return Response({'error': 'Admin required'}, status=403)

    if 'require_invite_code' in request.data:
        site.require_invite_code = request.data['require_invite_code']
        site.save()

    return Response({
        'require_invite_code': site.require_invite_code,
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def notification_prefs_view(request):
    """GET or PATCH the current user's email notification preferences."""
    prefs = NotificationPreference.for_user(request.user)

    if request.method == 'GET':
        return Response(NotificationPreferenceSerializer(prefs).data)

    serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_search(request):
    """Search users by username for DM targeting."""
    q = request.query_params.get('q', '').strip()
    if len(q) < 1:
        return Response([])
    users = (
        UserProfile.objects
        .filter(username__icontains=q)
        .exclude(id=request.user.id)
        [:20]
    )
    return Response([
        {
            'id': u.id,
            'username': u.username,
            'avatar_preset': getattr(u, 'avatar_preset', '') or '',
        }
        for u in users
    ])


# ── Invite Codes ────────────────────────────────────────────


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invite_code_list_create(request):
    """GET: list invite codes. POST: generate a new one."""
    if request.method == 'GET':
        if request.user.is_staff:
            codes = InviteCode.objects.select_related('created_by').all()
        else:
            codes = InviteCode.objects.filter(created_by=request.user)
        return Response({
            'invite_codes': InviteCodeSerializer(codes, many=True).data,
            'count': codes.count(),
        })

    # POST — generate new code
    max_uses = request.data.get('max_uses', 1)
    code = InviteCode.objects.create(
        created_by=request.user,
        max_uses=max_uses,
    )
    return Response(
        InviteCodeSerializer(code).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def invite_code_detail(request, code_id):
    """PATCH: toggle active. DELETE: remove code."""
    code = InviteCode.objects.filter(pk=code_id).first()
    if not code:
        return Response({'error': 'Code not found'}, status=status.HTTP_404_NOT_FOUND)
    if not request.user.is_staff and code.created_by_id != request.user.id:
        return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'DELETE':
        code.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH — update is_active or max_uses
    if 'is_active' in request.data:
        code.is_active = request.data['is_active']
    if 'max_uses' in request.data:
        code.max_uses = request.data['max_uses']
    code.save()
    return Response(InviteCodeSerializer(code).data)
