import os
from datetime import datetime
from boto3.dynamodb.conditions import Key
import boto3

class DynamoDatabase:
    def __init__(self):
        dynamodb = boto3.resource('dynamodb')
        self.table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])

        self.pk = 'URL'
        self.sk_prefix = 'LINK#'

    def save_url(self, url, title, summary):
        self.table.put_item(
            Item={
                'pk': self.pk,
                'sk': f'{self.sk_prefix}{datetime.now().isoformat()}#{url}',
                'url': url,
                'title': title,
                'summary': summary,
            }
        )

    def get_links(self):
        response = self.table.query(
            KeyConditionExpression=Key('pk').eq(self.pk) & Key('sk').begins_with(self.sk_prefix),
            ScanIndexForward=False
        )

        return response['Items'] or []

class InMemoryDatabase:
    def __init__(self):
        self.data = []

    def save_url(self, url, title, summary):
        self.data.append({
            'url': url,
            'title': title,
            'summary': summary,
        })

    def get_links(self):
        # reverse chronological order
        return self.data[::-1]



