import math

def add(num1, num2):
    return num1 + num2

def subtract(num1, num2):
    return num1 - num2

def multiply(num1, num2):
    return num1 * num2

def divide(num1, num2):
    if num2 == 0:
        raise ValueError('Cannot divide by zero')
    return num1 / num2

def main():
    print('Basic Calculator')
    print('1. Addition')
    print('2. Subtraction')
    print('3. Multiplication')
    print('4. Division')

    choice = input('Enter your choice (1-4): ')

    if choice in ('1', '2', '3', '4'):
        num1 = float(input('Enter first number: '))
        num2 = float(input('Enter second number: '))

        if choice == '1':
            print('Result:', add(num1, num2))
        elif choice == '2':
            print('Result:', subtract(num1, num2))
        elif choice == '3':
            print('Result:', multiply(num1, num2))
        elif choice == '4':
            print('Result:', divide(num1, num2))
    else:
        print('Invalid choice')

if __name__ == '__main__':
    main()