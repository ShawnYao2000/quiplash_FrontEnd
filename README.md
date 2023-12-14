# Readme for Quiplash

QUIPLASH is a fun and interactive chat application that allows users to communicate in real-time. The application is built using JavaScript, with the Express server framework, VueJS for the frontend, and Socket.IO for real-time communication.

## Running QUIPLASH

### Locally

To start the QUIPLASH application on your local machine, follow these steps:

1. Open your terminal.
2. Navigate to the directory where your QUIPLASH project is located.
3. Run the application using the following command:

```
$ npm start
```


This command will start the Express server and make the application available on your local machine.

### Deploying to Google App Engine (GAE)

To deploy the QUIPLASH application to Google App Engine, use the following steps:

1. Ensure that you have Google Cloud SDK installed and properly set up.
2. Authenticate your GAE account if you haven't already.
3. In the terminal, navigate to your QUIPLASH project directory.
4. Run the following command to deploy your application to GAE:

```
$ npm run gdeploy
```

This command utilizes a custom script defined in your `package.json` file that streamlines the deployment process to Google App Engine.

Remember to check the `app.yaml` file and ensure it's configured correctly for GAE deployment. Also, make sure that your Google Cloud project is set up correctly to receive and run your QUIPLASH application.
