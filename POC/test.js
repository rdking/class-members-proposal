var Privacy = require('./privacy.es6');

console.log("Testing basic classes...");
//We can't just inherit from Object by not extending.
//All non-Privacy objects must be wrapped to use as a base.
var Example = Privacy(class Example extends Privacy.wrap(Object) {
    static [Privacy.DATA]() {
        //This function contains field definitions for the data in this class
        return {
            ['private field1']: 'alpha',
            ['static private field2']: 0,
            ['protected field3']: 42,
            ['protected static field4']: 'You can see me!'
        }
    }

    constructor() {
        super();
    }

    print() {
        console.log(`field1 = ${this['#'].field1}`);
        console.log(`field2 = ${this.constructor['#'].field2}`);
        console.log(`field3 = ${this['#']['field3']}`);
        console.log(`field4 = ${this.constructor['#'].field4}`);
    }
});

var test1 = new Example();
test1.print();

console.log("\nTesting subclasses...");
var SubExample = Privacy(class SubExample extends Example {
    static [Privacy.DATA]() {
        return {
            yes: 'You can always see me!',
            ['static no']: "I didn't forget this either!",
            ['private field1']() {
                console.log("Non-interferring masking is possible as well.");
                /*
                I can't figure out how to get the line below to work. It seems that
                `super` is implemented in a way that doesn't directly access prototype
                properties.
                */
                console.log(`The old "field3" is still '${super['#'].field3}'!`);
                //*/
            }
        }
    }

    constructor() {
        super();
        this['#'].field3 = 21;
    }

    print() {
        console.log(`According to the superclass...`);
        super.print();
        console.log(`According to the subclass...`);
        this['#'].field1();
    }
});

test2 = new SubExample();
test2.print();
console.log(`test2.yes = ${test2.yes}`);
console.log(`SubExample.no = ${SubExample.no}`);
