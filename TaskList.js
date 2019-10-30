const {categories, writeTypes} = require('./Globals');
const requester = require('./ApiRequester');
const Task = require('./Task');
const Promise = require('bluebird');
const {categoryLists, boardId} = require("./trelloIds.json");

/**
 * Overall store for all the tasks
 *
 * Provides methods to load and write to both Trello and Google
 */
class TaskList {
    constructor() {
        /**
         * The tasks contained in this list
         * @type {Task[]}
         */
        this.tasks = [];
        this.boardId = boardId;
        this.categoryLists = categoryLists;
    }

    /**
     * Gets a task given the google id.
     * If no task could be found, it will make a new one
     *
     * @param id The Google id to search by
     * @return {Task}
     */
    getTaskFromGoogle(id) {
        /* Find index */
        let index = this.tasks.findIndex((data) => {
            return data.googleId === id
        });
        /* Make new task if one doesn't exist */
        if (index === -1) {
            this.tasks.push(new Task());
            index = this.tasks.length - 1;
            this.tasks[index].googleId = id;
        }
        return this.tasks[index];
    }

    /**
     * Get a task by Trello id.
     * If no task could be found, will create a new one
     *
     * @param id The Trello id to search by
     * @return {Task} The task linked to the id
     */
    getTaskFromTrello(id) {
        /* Find index */
        let index = this.tasks.findIndex((data) => {
            return data.trelloId === id
        });

        /* Make new task if one doesn't exist */
        if (index === -1) {
            this.tasks.push(new Task());
            index = this.tasks.length - 1;
            this.tasks[index].trelloId = id;
        }
        return this.tasks[index];
    }

    /**
     * Loads a tasks from the google api.
     * Tries to link them to trello cards using the extra data set on the card
     *
     * @return {Promise} A promise resolved when all tasks have been loaded
     */
    loadFromGoogle() {
        const outerList = this;
        /* Make a new promise */
        return new Promise(resolve => {
            /* This needs to be a nested function to have access to the resolve
             * And to not make a new promise each recusion */
            function innerRecurse(page) {
                console.log(`Requesting page ${page} from google`);
                /* Request the tasks */
                requester.getTaskPage(page)
                    .then(body => {
                        outerList._loadFromGoogle(body);
                        if (body.next != null) {
                            /* Recurse again if there are more pages */
                            innerRecurse(body.next);
                        } else {
                            /* Resolve the promise and stop if there are no more pages */
                            resolve();
                        }
                    });
            }

            innerRecurse("https://codein.withgoogle.com/api/program/current/tasks/?page=1");
        });
    }

    /**
     * Load the json data returned by the api call
     *
     * @param data The json returned by the api call
     * @private
     */
    _loadFromGoogle(data) {
        data.results.forEach((taskData) => this.getTaskFromGoogle(taskData.id).loadFromGoogle(taskData))
    }

    /**
     * Load the cards from each category list on Trello
     *
     * @return {Promise} A promise resolved when all categories have been loaded
     */
    loadFromTrello() {
        /**
         * Loads the data from all the trello lists
         *
         * Returns a promise that triggers when all the tasks are fully updated
         */

        const categoryPromises = [];
        for (let category in categories) {
            console.log(`Requesting ${category.toLowerCase()} list from Trello`);

            /* Make a call for the category, making a new promise to finish when all are done */
            categoryPromises.push(new Promise(resolve => {
                requester.getListCards(this.categoryLists[categories[category]])
                    .then((body) => {

                        /* Make calls for each field, storing the promises */
                        console.log(`Processing ${category.toLowerCase()}'s cards`);
                        const fieldPromises = [];
                        body.forEach((item) => fieldPromises.push(
                            this.getTaskFromTrello(item.id).loadFromTrello(item)));

                        /* Resolve the category promise when the fields are all done */
                        Promise.all(fieldPromises).then(() => resolve());
                    });
            }));
        }
        /* Return a promise that will finish when all the categories are done */
        return Promise.all(categoryPromises);
    }

    /**
     * Writes all tasks to google.
     * If a task has no google id, a error message is printed and it is skipped.
     *
     * @return {Promise} A promise that is resolved when all tasks have been written
     */
    writeToGoogle(writeType) {
        console.log("Writing to Google");
        const promises = [];
        this.tasks.forEach(task =>
            promises.push(task.writeToGoogle(writeType))
        );
        return Promise.all(promises);
    }

    /**
     * Writes all tasks to Trello.
     * If a task has no Trello id, a error message is printed and it is skipped.
     *
     * Note this is slow to avoid the api rate limits. Operates at a rate of 1 call per 0.3s
     *
     * @param writeType {number}
     * @return {Promise} A promise that is resolved when all tasks have been written
     */
    writeToTrello(writeType) {
        console.log("Writing to Trello");
        const promises = [];
        this.tasks.forEach(task =>
            promises.push(task.writeToTrello(writeType))
        );
        return Promise.all(promises);
    }

    handleWebhookActivate(data) {
        const card = this.getTaskFromTrello(data.action.data.card.id);
        card.resetStatus();
        switch (data.action.type) {
            case 'updateCard':
                console.log("Webhook triggered: card updated");
                card.loadBasicTrello(data.action.data.card);
                break;
            case 'updateCustomFieldItem':
                console.log("Webhook triggered: custom field changed");
                card.loadCustomTrello([data.action.data.customFieldItem]);
                break;
            default:
                console.log("Webhook triggered: Irrelevant change detected");
        }
        card.writeToGoogle(writeTypes.ONLY_CHANGED);
    }

    /**
     * Validates all the current webhooks, removing those without a card and adding new ones for new cards
     */
    createWebhooks() {
        requester.getTrelloWebhooks()
            .then(webhooks => {
                webhooks.forEach(webhook => {
                    requester.deleteTrelloWebhook(webhook.id);
                });
                this.tasks.forEach(card => {
                    console.warn(`Creating webhook for "${card.name}" (${card.trelloId})`);
                    requester.createTrelloWebhook(card.trelloId);
                });
            });
    }

    /**
     * Resets all the 'edited' status on all the fields on all the tasks.
     */
    resetStatus() {
        this.tasks.forEach(task => task.resetStatus());
    }
}

module.exports = new TaskList();