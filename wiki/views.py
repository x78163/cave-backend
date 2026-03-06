"""Wiki views — articles, categories, tags, revisions, images, search."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as http_status

from .linking import process_article_links, relink_articles_for_new_title
from .models import (
    Article, ArticleRevision, ArticleTag, ArticleLink,
    ArticleImage, Category,
)
from .serializers import (
    ArticleListSerializer, ArticleDetailSerializer, ArticleCreateSerializer,
    ArticleRevisionSerializer, ArticleTagSerializer, ArticleLinkSerializer,
    ArticleImageSerializer, CategorySerializer,
)


# ── Categories ──────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def category_list(request):
    """List top-level categories as a tree."""
    categories = Category.objects.filter(parent__isnull=True)
    serializer = CategorySerializer(categories, many=True)
    return Response(serializer.data)


# ── Tags ────────────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def tag_list(request):
    """List all tags."""
    tags = ArticleTag.objects.all()
    serializer = ArticleTagSerializer(tags, many=True)
    return Response(serializer.data)


# ── Articles CRUD ───────────────────────────────────────────


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def article_list(request):
    """
    GET: List/search published articles.
    POST: Create new article (editors/admins only).
    """
    if request.method == 'GET':
        articles = Article.objects.filter(status='published')

        # Visibility filter
        if not request.user.is_authenticated:
            articles = articles.filter(visibility='public')

        # Search
        q = request.query_params.get('q', '').strip()
        if q:
            articles = articles.filter(
                Q(title__icontains=q)
                | Q(summary__icontains=q)
                | Q(content__icontains=q)
            )

        # Category filter
        category_slug = request.query_params.get('category', '')
        if category_slug:
            articles = articles.filter(category__slug=category_slug)

        # Tag filter
        tag_slug = request.query_params.get('tag', '')
        if tag_slug:
            articles = articles.filter(tags__slug=tag_slug)

        articles = articles.select_related(
            'category', 'created_by', 'last_edited_by',
        ).prefetch_related('tags').distinct()

        serializer = ArticleListSerializer(articles, many=True)
        return Response(serializer.data)

    # POST — create article
    if not request.user.is_authenticated:
        return Response(status=http_status.HTTP_401_UNAUTHORIZED)
    if not (request.user.is_wiki_editor or request.user.is_staff):
        return Response(
            {'detail': 'Only wiki editors can create articles.'},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    serializer = ArticleCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    article = serializer.save(
        created_by=request.user,
        last_edited_by=request.user,
    )

    # Run auto-linking engine
    tokenized = process_article_links(article)
    if tokenized != article.content:
        article.content = tokenized
        article.save(update_fields=['content'])

    # Create initial revision
    ArticleRevision.objects.create(
        article=article,
        content=article.content,
        edit_summary='Initial creation',
        editor=request.user,
        revision_number=1,
    )

    # Re-link existing articles that mention this new article's title
    relink_articles_for_new_title(article)

    detail = ArticleDetailSerializer(article, context={'request': request})
    return Response(detail.data, status=http_status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def article_detail(request, slug):
    """
    GET: Article detail with full content.
    PATCH: Edit article (creates revision).
    DELETE: Archive article (admin only).
    """
    article = get_object_or_404(Article, slug=slug)

    if request.method == 'GET':
        # Check visibility
        if article.status != 'published' and not (
            request.user.is_authenticated
            and (request.user == article.created_by or request.user.is_staff)
        ):
            return Response(status=http_status.HTTP_404_NOT_FOUND)

        if article.visibility == 'members_only' and not request.user.is_authenticated:
            return Response(
                {'detail': 'This article is only available to members.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        serializer = ArticleDetailSerializer(article, context={'request': request})
        return Response(serializer.data)

    if request.method == 'PATCH':
        if not request.user.is_authenticated:
            return Response(status=http_status.HTTP_401_UNAUTHORIZED)

        # Check locked
        if article.is_locked and not request.user.is_staff:
            return Response(
                {'detail': 'This article is locked and cannot be edited.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        edit_summary = request.data.get('edit_summary', '')
        old_title = article.title

        # Strip cave_description — managed by cave sync only
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        data.pop('cave_description', None)
        data.pop('source_cave', None)

        serializer = ArticleCreateSerializer(
            article, data=data, partial=True,
        )
        serializer.is_valid(raise_exception=True)

        article = serializer.save(last_edited_by=request.user)

        # Run auto-linking engine
        tokenized = process_article_links(article)
        if tokenized != article.content:
            article.content = tokenized
            article.save(update_fields=['content'])

        # Create revision
        last_rev = article.revisions.order_by('-revision_number').first()
        rev_num = (last_rev.revision_number + 1) if last_rev else 1

        ArticleRevision.objects.create(
            article=article,
            content=article.content,
            edit_summary=edit_summary,
            editor=request.user,
            revision_number=rev_num,
        )

        # If title changed, re-link existing articles for the new title
        if article.title != old_title:
            relink_articles_for_new_title(article)

        detail = ArticleDetailSerializer(article, context={'request': request})
        return Response(detail.data)

    if request.method == 'DELETE':
        if not request.user.is_authenticated:
            return Response(status=http_status.HTTP_401_UNAUTHORIZED)
        if not request.user.is_staff:
            return Response(
                {'detail': 'Only admins can delete articles.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        article.status = 'archived'
        article.save(update_fields=['status'])
        return Response(status=http_status.HTTP_204_NO_CONTENT)


# ── Revision History ────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def article_history(request, slug):
    """List all revisions for an article."""
    article = get_object_or_404(Article, slug=slug)
    revisions = article.revisions.select_related('editor').all()
    serializer = ArticleRevisionSerializer(revisions, many=True)
    return Response(serializer.data)


@api_view(['GET', 'POST'])
def article_revision(request, slug, rev_num):
    """
    GET: Get a specific revision of an article.
    POST: Restore this revision (creates a new revision with the old content).
    """
    article = get_object_or_404(Article, slug=slug)
    revision = get_object_or_404(
        ArticleRevision, article=article, revision_number=rev_num,
    )

    if request.method == 'GET':
        serializer = ArticleRevisionSerializer(revision)
        return Response(serializer.data)

    # POST — restore this revision
    if not request.user.is_authenticated:
        return Response(status=http_status.HTTP_401_UNAUTHORIZED)
    if article.is_locked and not request.user.is_staff:
        return Response(
            {'detail': 'This article is locked.'},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    # Update article content to the revision's content
    article.content = revision.content
    article.last_edited_by = request.user
    article.save(update_fields=['content', 'last_edited_by', 'updated_at'])

    # Run auto-linking on restored content
    tokenized = process_article_links(article)
    if tokenized != article.content:
        article.content = tokenized
        article.save(update_fields=['content'])

    # Create new revision
    last_rev = article.revisions.order_by('-revision_number').first()
    new_rev_num = (last_rev.revision_number + 1) if last_rev else 1

    ArticleRevision.objects.create(
        article=article,
        content=article.content,
        edit_summary=f'Restored revision #{rev_num}',
        editor=request.user,
        revision_number=new_rev_num,
    )

    return Response({'detail': f'Restored revision #{rev_num}', 'slug': article.slug})


# ── Article Images ──────────────────────────────────────────


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def article_image_upload(request, slug):
    """Upload an image for an article."""
    article = get_object_or_404(Article, slug=slug)

    image_file = request.FILES.get('image')
    if not image_file:
        return Response(
            {'detail': 'No image file provided.'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    article_image = ArticleImage.objects.create(
        article=article,
        image=image_file,
        caption=request.data.get('caption', ''),
        uploaded_by=request.user,
    )
    serializer = ArticleImageSerializer(article_image)
    return Response(serializer.data, status=http_status.HTTP_201_CREATED)


# ── Search ──────────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def article_search(request):
    """Full-text search across published articles."""
    q = request.query_params.get('q', '').strip()
    if not q or len(q) < 2:
        return Response([])

    articles = Article.objects.filter(
        status='published',
    ).filter(
        Q(title__icontains=q)
        | Q(summary__icontains=q)
        | Q(content__icontains=q)
        | Q(cave_description__icontains=q)
        | Q(tags__name__icontains=q)
    )

    if not request.user.is_authenticated:
        articles = articles.filter(visibility='public')

    articles = articles.select_related(
        'category', 'created_by',
    ).prefetch_related('tags').distinct()[:50]

    serializer = ArticleListSerializer(articles, many=True)
    return Response(serializer.data)


# ── Cross-References ────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def article_links(request, slug):
    """Get all cross-references for an article."""
    article = get_object_or_404(Article, slug=slug)

    outgoing = ArticleLink.objects.filter(
        source_article=article,
    ).select_related('target_article', 'target_cave')

    incoming = ArticleLink.objects.filter(
        target_article=article,
    ).select_related('source_article')

    return Response({
        'outgoing': ArticleLinkSerializer(outgoing, many=True).data,
        'incoming': [
            {
                'article_title': link.source_article.title,
                'article_slug': link.source_article.slug,
                'link_text': link.link_text,
            }
            for link in incoming
        ],
    })


# ── Cave Reverse Lookup ───────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def cave_articles(request, cave_id):
    """Get wiki articles linked to a specific cave."""
    # Direct source_cave link
    articles = Article.objects.filter(
        source_cave_id=cave_id, status='published',
    ).select_related('category', 'created_by', 'last_edited_by').prefetch_related('tags')

    serializer = ArticleListSerializer(articles, many=True)
    return Response(serializer.data)
