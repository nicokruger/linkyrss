from flask import Flask, render_template, request, Response
import werkzeug.exceptions
from serverless_wsgi import handle_request
import os
import logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger('botocore').setLevel(logging.WARNING)
logging.getLogger('boto3').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logging.getLogger('werkzeug').setLevel(logging.WARNING)
logging.getLogger('openai').setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

import linkyai
import database


def make_app():
    database_type = os.environ.get('DATABASE_TYPE', 'memory')
    if database_type == 'dynamo':
        db = database.DynamoDatabase()
    elif database_type == 'memory':
        db = database.InMemoryDatabase()
    else:
        # default
        db = database.InMemoryDatabase()

    app = Flask(
        __name__,
        static_folder='./static',
        static_url_path='/',
        template_folder='templates'
    )

    @app.route('/api/extract', methods=['POST'])
    def extract_info():
        url = request.form.get('url')

        data = linkyai.get_summary(url)
        logger.info(f"Extracted {data}")

        db.save_url(url, data['title'], data['summary'])

        return render_template('extract.html', data=data)

    @app.route('/')
    def home():
        items = db.get_links()

        return render_template('index.html', count=len(items))


    @app.route('/view')
    def view():
        items = db.get_links()

        return render_template('view.html', items=items)

    @app.route('/rss')
    def rss():
        items = db.get_links()

        return Response(render_template('rss.xml', items=items), mimetype='application/rss+xml')

    @app.errorhandler(Exception)
    def handle_error(e):
        if isinstance(e, werkzeug.exceptions.NotFound):
            return render_template('error.html', message='Page not found'), 404
        else:
            logger.exception(e)
            return render_template('error.html', message=str(e)), 500

    return app

def lambda_handler(event, context):
    if event.get('source', '') == 'keepwarm':
        print("keepwarm")
        return {'statusCode': 200}
    return handle_request(make_app(), event, context)

if __name__ == '__main__':
    make_app().run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))

