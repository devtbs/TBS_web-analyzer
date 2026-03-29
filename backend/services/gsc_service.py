"""Google Search Console API service for fetching properties and data"""
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class GSCService:
    """Service for interacting with Google Search Console API"""
    
    SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']
    
    def __init__(self, access_token: str = None, refresh_token: str = None):
        """
        Initialize GSC service.
        
        - If refresh_token is provided: builds long-lived credentials that auto-refresh.
          This is the preferred path for permanent connections.
        - If only access_token is provided: uses it directly (expires in ~1 hour).
        """
        from config import settings

        if refresh_token:
            # Long-lived credentials using the refresh token
            self.credentials = Credentials(
                token=access_token,            # current access token (may be None initially)
                refresh_token=refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                scopes=self.SCOPES,
            )
            # If token is missing or expired, refresh immediately
            if not self.credentials.valid:
                self.credentials.refresh(GoogleRequest())
        elif access_token:
            # Short-lived fallback (legacy / first-time connect before code exchange)
            self.credentials = Credentials(token=access_token)
        else:
            raise ValueError("Either access_token or refresh_token must be provided")

        self.service = build('searchconsole', 'v1', credentials=self.credentials)

    @classmethod
    def from_stored_token(cls, stored_token: str, is_refresh_token: bool = False):
        """
        Factory: create a GSCService from the value stored in the database.
        
        Args:
            stored_token: The token string from the database.
            is_refresh_token: True if the stored value is a refresh token.
        """
        if is_refresh_token:
            return cls(refresh_token=stored_token)
        else:
            return cls(access_token=stored_token)

    async def get_properties(self) -> List[Dict[str, str]]:
        """
        Fetch all Search Console properties accessible by the user.
        
        Returns:
            List of properties with their URLs and permission levels.
        """
        try:
            sites_list = self.service.sites().list().execute()
            properties = []
            site_entries = sites_list.get('siteEntry', [])

            for site in site_entries:
                site_url = site.get('siteUrl')
                # Filter out domain properties (sc-domain:)
                if site_url and not site_url.startswith('sc-domain:'):
                    properties.append({
                        'url': site_url,
                        'permission_level': site.get('permissionLevel'),
                    })

            logger.info(f"Found {len(properties)} URL prefix properties")
            return properties

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching GSC properties: {str(e)}")
            raise Exception(f"Failed to fetch Search Console properties: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching GSC properties: {str(e)}")
            raise Exception(f"Failed to fetch Search Console properties: {str(e)}")

    async def verify_property_access(self, property_url: str) -> bool:
        """Verify that the user has access to a specific property."""
        try:
            self.service.sites().get(siteUrl=property_url).execute()
            return True
        except HttpError as e:
            if e.resp.status == 404:
                return False
            logger.error(f"Error verifying property access: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error verifying property: {str(e)}")
            return False

    async def get_pages_with_queries(self, property_url: str, days: int = 90) -> List[Dict]:
        """
        Fetch all pages from a property with their ranking queries.
        
        Args:
            property_url: The URL of the GSC property.
            days: Number of days to look back (default 90).
            
        Returns:
            List of pages with their queries, clicks, impressions, position.
        """
        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)

            request = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['page', 'query'],
                'rowLimit': 25000,
                'startRow': 0,
                'dataState': 'all'
            }

            response = self.service.searchanalytics().query(
                siteUrl=property_url,
                body=request
            ).execute()

            pages_data = {}
            rows = response.get('rows', [])

            for row in rows:
                page = row['keys'][0]
                query = row['keys'][1]
                clicks = row.get('clicks', 0)
                impressions = row.get('impressions', 0)
                position = row.get('position', 0)
                ctr = row.get('ctr', 0)

                if page not in pages_data:
                    pages_data[page] = {
                        'url': page,
                        'total_clicks': 0,
                        'total_impressions': 0,
                        'avg_position': 0,
                        'queries': []
                    }

                pages_data[page]['total_clicks'] += clicks
                pages_data[page]['total_impressions'] += impressions
                pages_data[page]['queries'].append({
                    'query': query,
                    'clicks': clicks,
                    'impressions': impressions,
                    'position': round(position, 1),
                    'ctr': round(ctr * 100, 2)
                })

            for page_url, data in pages_data.items():
                if data['queries']:
                    total_position = sum(q['position'] for q in data['queries'])
                    data['avg_position'] = round(total_position / len(data['queries']), 1)
                    data['queries'].sort(key=lambda x: x['clicks'], reverse=True)

            pages_list = list(pages_data.values())
            pages_list.sort(key=lambda x: x['total_clicks'], reverse=True)

            logger.info(f"Fetched {len(pages_list)} pages with queries from {property_url}")
            return pages_list

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching pages: {str(e)}")
            raise Exception(f"Failed to fetch pages from Search Console: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching pages: {str(e)}")
            raise Exception(f"Failed to fetch pages: {str(e)}")

    async def get_search_analytics(self, property_url: str, days: int = 365, group_by: str = 'daily') -> Dict:
        """Fetch search analytics time-series data for charts and totals."""
        try:
            from datetime import datetime, timedelta
            from collections import defaultdict

            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)

            request = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['date'],
                'rowLimit': 25000,
                'dataState': 'all'
            }

            response = self.service.searchanalytics().query(
                siteUrl=property_url,
                body=request
            ).execute()

            rows = response.get('rows', [])

            total_clicks = 0
            total_impressions = 0
            total_position = 0

            grouped_by_date = defaultdict(lambda: {'clicks': 0, 'impressions': 0})

            for row in rows:
                date_str = row['keys'][0]
                date_obj = datetime.strptime(date_str, '%Y-%m-%d')
                
                # Compute grouping key
                if group_by == 'monthly':
                    day_key = date_str[:7]
                elif group_by == 'weekly':
                    start_of_week = date_obj - timedelta(days=date_obj.weekday())
                    day_key = start_of_week.strftime('%Y-%m-%d')
                else:
                    day_key = date_str

                clicks = row.get('clicks', 0)
                impressions = row.get('impressions', 0)
                position = row.get('position', 0)

                total_clicks += clicks
                total_impressions += impressions
                total_position += position * impressions

                if 'total_position' not in grouped_by_date[day_key]:
                    grouped_by_date[day_key]['total_position'] = 0

                grouped_by_date[day_key]['clicks'] += clicks
                grouped_by_date[day_key]['impressions'] += impressions
                grouped_by_date[day_key]['total_position'] += position * impressions

            avg_position = (total_position / total_impressions) if total_impressions > 0 else 0
            avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0

            chart_data = []
            for day_key in sorted(grouped_by_date.keys()):
                
                if group_by == 'monthly':
                    m_abbr = datetime.strptime(day_key, '%Y-%m').strftime('%b')
                else:
                    m_abbr = datetime.strptime(day_key, '%Y-%m-%d').strftime('%b %d')
                    
                m_clicks = grouped_by_date[day_key]['clicks']
                m_impressions = grouped_by_date[day_key]['impressions']
                m_tot_pos = grouped_by_date[day_key].get('total_position', 0)

                m_ctr = (m_clicks / m_impressions * 100) if m_impressions > 0 else 0
                m_pos = (m_tot_pos / m_impressions) if m_impressions > 0 else 0

                chart_data.append({
                    'month': m_abbr,  # Retained the key name 'month' for frontend compatibility
                    'clicks': m_clicks,
                    'impressions': m_impressions,
                    'ctr': round(m_ctr, 2),
                    'position': round(m_pos, 2)
                })

            return {
                'totals': {
                    'clicks': total_clicks,
                    'impressions': total_impressions,
                    'ctr': avg_ctr,
                    'position': avg_position
                },
                'chart_data': chart_data[-(30 if group_by == 'daily' else 14 if group_by == 'weekly' else 12):]
            }
        except Exception as e:
            logger.error(f"Error fetching analytics chart data: {str(e)}")
            raise Exception(f"Failed to fetch analytics: {str(e)}")


async def get_user_properties(stored_token: str, is_refresh_token: bool = False) -> List[Dict[str, str]]:
    """
    Helper: get user's Search Console properties from stored credentials.
    
    Args:
        stored_token: Token string from the database.
        is_refresh_token: True if the token is a refresh token.
    """
    service = GSCService.from_stored_token(stored_token, is_refresh_token=is_refresh_token)
    return await service.get_properties()
